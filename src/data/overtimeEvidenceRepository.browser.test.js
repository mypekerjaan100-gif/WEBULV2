import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const TEST_PASSWORD = process.env.L1_EVIDENCE_TEST_PASSWORD
if (!TEST_PASSWORD) throw new Error('L1_EVIDENCE_TEST_PASSWORD is required')
const OWN_ACTIVITY = '20000000-0000-4000-8000-000000000001'
const SIBLING_ACTIVITY = '20000000-0000-4000-8000-000000000002'

const server = await createServer({
  server: { host: '127.0.0.1', port: 4180 },
  logLevel: 'error',
  plugins: [{
    name: 'overtime-evidence-test-page',
    configureServer(viteServer) {
      viteServer.middlewares.use('/evidence-integration-test', (_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><title>Overtime evidence integration test</title>')
      })
    },
  }],
})

let browser
try {
  await server.listen()
  browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
  })
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:4180/evidence-integration-test')

  const result = await page.evaluate(async ({ password, ownActivity, siblingActivity }) => {
    const { supabase } = await import('/src/lib/supabaseClient.js')
    const repository = await import('/src/data/overtimeEvidenceRepository.js')
    const { processEvidenceFile } = await import('/src/data/evidenceFileProcessor.js')

    async function signIn(role) {
      await supabase.auth.signOut()
      const { error } = await supabase.auth.signInWithPassword({
        email: `l1-evidence-${role}@example.invalid`,
        password,
      })
      if (error) throw new Error(`${role} sign-in failed: ${error.message}`)
    }

    async function makeImage(name, width = 1800, height = 1200) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      const pixels = context.createImageData(width, height)
      for (let offset = 0; offset < pixels.data.length; offset += 65536) {
        crypto.getRandomValues(pixels.data.subarray(offset, Math.min(offset + 65536, pixels.data.length)))
      }
      for (let index = 3; index < pixels.data.length; index += 4) pixels.data[index] = 255
      context.putImageData(pixels, 0, 0)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      return new File([blob], name, { type: 'image/png' })
    }

    await signIn('ulp')
    const source = await makeImage('briefing-original.png')
    const uploaded = await repository.uploadOvertimeEvidence({
      activityId: ownActivity,
      evidenceType: 'FOTO_BRIEFING',
      file: source,
    })
    if (uploaded.status !== 'ACTIVE') throw new Error('Uploaded evidence is not ACTIVE')
    if (uploaded.storedSizeBytes > 1024 * 1024) throw new Error('Stored evidence exceeds 1 MB')
    if (!uploaded.storagePath.startsWith('pelayanan-teknik/')) throw new Error('Storage path is not canonical')

    const recoverySource = await makeImage('briefing-recovery.png', 600, 400)
    const recoveryProcessed = await processEvidenceFile(recoverySource, 'FOTO_BRIEFING')
    const { data: recoveryPending, error: recoveryPrepareError } = await supabase.rpc(
      'prepare_overtime_evidence_upload',
      {
        p_activity_id: ownActivity,
        p_evidence_type: 'FOTO_BRIEFING',
        p_original_filename: recoveryProcessed.original.filename,
        p_original_mime_type: recoveryProcessed.original.mimeType,
        p_original_size_bytes: recoveryProcessed.original.sizeBytes,
        p_stored_size_bytes: recoveryProcessed.stored.sizeBytes,
        p_stored_mime_type: recoveryProcessed.stored.mimeType,
        p_checksum: recoveryProcessed.stored.checksum,
        p_sort_order: 1,
        p_supersedes_evidence_id: null,
      },
    )
    if (recoveryPrepareError) throw recoveryPrepareError
    const { error: recoveryUploadError } = await supabase.storage
      .from('overtime-evidence')
      .upload(recoveryPending.storage_path, recoveryProcessed.file, {
        contentType: recoveryProcessed.stored.mimeType,
        upsert: false,
      })
    if (recoveryUploadError) throw recoveryUploadError

    const ownRows = await repository.listOvertimeEvidence(ownActivity)
    if (!ownRows.some((row) => row.id === uploaded.id)) {
      throw new Error('Database metadata does not match uploaded evidence')
    }
    const signed = await repository.createOvertimeEvidenceSignedUrl(uploaded.id)
    if (signed.expiresIn !== 300) throw new Error('Signed URL expiry is not temporary')
    const signedResponse = await fetch(signed.signedUrl)
    if (!signedResponse.ok) throw new Error(`Signed preview failed: ${signedResponse.status}`)
    const signedBlob = await signedResponse.blob()
    if (signedBlob.size !== uploaded.storedSizeBytes) throw new Error('Signed preview size differs from metadata')

    const { data: publicData } = supabase.storage
      .from('overtime-evidence')
      .getPublicUrl(uploaded.storagePath)
    const publicResponse = await fetch(publicData.publicUrl)
    if (publicResponse.ok) throw new Error('Private evidence is available through a public URL')

    let siblingDenied = false
    try {
      await repository.uploadOvertimeEvidence({
        activityId: siblingActivity,
        evidenceType: 'FOTO_BRIEFING',
        file: await makeImage('sibling.png', 600, 400),
      })
    } catch (error) {
      siblingDenied = /scope|status|authorized|permission/i.test(error.message)
    }
    if (!siblingDenied) throw new Error('ADMIN_ULP sibling upload was not denied')

    const { data: preparedOversize, error: prepareOversizeError } = await supabase.rpc(
      'prepare_overtime_evidence_upload',
      {
        p_activity_id: ownActivity,
        p_evidence_type: 'SPK',
        p_original_filename: 'oversized.doc',
        p_original_mime_type: 'application/msword',
        p_original_size_bytes: 1024 * 1024 + 1,
        p_stored_size_bytes: 1024 * 1024,
        p_stored_mime_type: 'application/msword',
        p_checksum: null,
        p_sort_order: 0,
        p_supersedes_evidence_id: null,
      },
    )
    if (prepareOversizeError) throw prepareOversizeError
    const oversizedFile = new File(
      [new Uint8Array(1024 * 1024 + 1)],
      'oversized.doc',
      { type: 'application/msword' },
    )
    const { error: oversizedUploadError } = await supabase.storage
      .from('overtime-evidence')
      .upload(preparedOversize.storage_path, oversizedFile, {
        contentType: oversizedFile.type,
        upsert: false,
      })
    if (!oversizedUploadError) throw new Error('Bucket accepted an object larger than 1 MB')
    const { error: cancelOversizeError } = await supabase.rpc(
      'cancel_overtime_evidence_upload',
      { p_evidence_id: preparedOversize.id },
    )
    if (cancelOversizeError) throw cancelOversizeError

    await signIn('up3')
    const up3Rows = await repository.listOvertimeEvidence(ownActivity)
    if (!up3Rows.some((row) => row.id === uploaded.id)) {
      throw new Error('ADMIN_UP3 cannot list own-UP3 evidence')
    }
    await repository.createOvertimeEvidenceSignedUrl(uploaded.id)
    let up3DeleteDenied = false
    try {
      await repository.deleteOvertimeEvidence(uploaded.id)
    } catch {
      up3DeleteDenied = true
    }
    if (!up3DeleteDenied) throw new Error('ADMIN_UP3 evidence delete was not denied')

    for (const role of ['tl', 'manager']) {
      await signIn(role)
      const rows = await repository.listOvertimeEvidence(ownActivity)
      if (!rows.some((row) => row.id === uploaded.id)) {
        throw new Error(`${role} cannot read assigned evidence`)
      }
      await repository.createOvertimeEvidenceSignedUrl(uploaded.id)
      let deleteDenied = false
      try {
        await repository.deleteOvertimeEvidence(uploaded.id)
      } catch {
        deleteDenied = true
      }
      if (!deleteDenied) throw new Error(`${role} evidence delete was not denied`)
    }

    await signIn('ulp-successor')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await supabase.rpc('finalize_overtime_evidence_upload', {
        p_evidence_id: recoveryPending.id,
      })
      if (error || data.status !== 'ACTIVE') throw error ?? new Error('Recovery finalize failed')
    }
    let recoveryPath
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await supabase.rpc('begin_overtime_evidence_delete', {
        p_evidence_id: recoveryPending.id,
      })
      if (error) throw error
      recoveryPath = data
    }
    const { error: recoveryRemoveError } = await supabase.storage
      .from('overtime-evidence')
      .remove([recoveryPath])
    if (recoveryRemoveError) throw recoveryRemoveError
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { error } = await supabase.rpc('finalize_overtime_evidence_delete', {
        p_evidence_id: recoveryPending.id,
      })
      if (error) throw error
    }
    const activeRows = await repository.listOvertimeEvidence(ownActivity)
    for (const row of activeRows) await repository.deleteOvertimeEvidence(row.id)
    const afterDelete = await repository.listOvertimeEvidence(ownActivity)
    if (afterDelete.length !== 0) throw new Error('Deleted evidence remains active')
    await supabase.auth.signOut()

    return {
      evidenceId: uploaded.id,
      storedSizeBytes: uploaded.storedSizeBytes,
      signedUrlSeconds: signed.expiresIn,
      siblingDenied,
      up3DeleteDenied,
    }
  }, {
    password: TEST_PASSWORD,
    ownActivity: OWN_ACTIVITY,
    siblingActivity: SIBLING_ACTIVITY,
  })

  console.log(`Storage integration passed: ${JSON.stringify(result)}`)
} finally {
  if (browser) await browser.close()
  await server.close()
}
