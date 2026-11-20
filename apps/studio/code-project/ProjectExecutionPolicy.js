/**
 * Local user approval for complete Three.js projects. This is a trust gate,
 * not a JavaScript sandbox: approved source still runs in the browser realm.
 */
export async function projectExecutionFingerprint(project,revision) {
  if(!project?.id || !Number.isSafeInteger(revision)) throw new TypeError('PROJECT_APPROVAL_INPUT_INVALID');
  const files=Object.entries(project.files || {}).sort(([a],[b])=>a.localeCompare(b,'en'));
  const resources=Object.entries(project.resources || {}).sort(([a],[b])=>a.localeCompare(b,'en'));
  // Byte-level content of every referenced file and resource is covered.
  const bytes=new TextEncoder().encode(JSON.stringify({
    id:project.id,revision,entry:project.entry || 'main.js',source:project.source,
    files,resources
  }));
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return [...digest].map(value=>value.toString(16).padStart(2,'0')).join('');
}

export async function assertApprovedProject(approval,project,revision) {
  if(!approval || approval.id!==project?.id || approval.revision!==revision)
    throw Object.assign(new Error('PROJECT_EXECUTION_REVIEW_REQUIRED'),{code:'PROJECT_EXECUTION_REVIEW_REQUIRED'});
  if(approval.digest!==await projectExecutionFingerprint(project,revision))
    throw Object.assign(new Error('PROJECT_EXECUTION_REVIEW_REQUIRED'),{code:'PROJECT_EXECUTION_REVIEW_REQUIRED'});
}
