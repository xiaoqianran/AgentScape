const finiteBounds = (bounds) => bounds && ['min','max'].every((key) => Array.isArray(bounds[key]) && bounds[key].length === 3 && bounds[key].every(Number.isFinite));

export class SegmentationEvidencePass {
  async run(context) {
    const evidence = context.partSegmentation;
    if (!evidence) return context;
    const issues = [];
    const faceCount = Number(evidence.faceCount);
    if (evidence.version !== 1 || !evidence.source || !Number.isInteger(faceCount) || faceCount <= 0 || !Array.isArray(evidence.segments)) {
      issues.push({ code:'SEGMENTATION_FORMAT', message:'Segmentation evidence requires version=1, source, faceCount and segments[].' });
    }
    const ids = new Set();
    let labeledFaces = 0;
    for (const segment of evidence.segments || []) {
      const id = String(segment.id ?? '');
      if (!id || ids.has(id)) { issues.push({ code:'SEGMENTATION_ID_INVALID', segment:id || null }); continue; }
      ids.add(id);
      if (!Number.isInteger(segment.faceCount) || segment.faceCount <= 0) issues.push({ code:'SEGMENTATION_FACE_COUNT_INVALID', segment:id });
      else labeledFaces += segment.faceCount;
      if (segment.bounds && !finiteBounds(segment.bounds)) issues.push({ code:'SEGMENTATION_BOUNDS_INVALID', segment:id });
    }
    if (Number.isFinite(faceCount) && labeledFaces > faceCount) issues.push({ code:'SEGMENTATION_COVERAGE_INVALID', message:'Segment face counts exceed source face count.' });

    const summary = {
      version:evidence.version,
      source:evidence.source,
      faceCount,
      labeledFaces,
      coverage:faceCount > 0 ? labeledFaces / faceCount : 0,
      segments:(evidence.segments || []).map((segment) => ({
        id:String(segment.id),
        faceCount:segment.faceCount,
        ...(Number.isFinite(segment.confidence) ? { confidence:segment.confidence } : {}),
        ...(segment.semantic ? { semantic:segment.semantic } : {}),
        ...(segment.bounds ? { bounds:structuredClone(segment.bounds) } : {})
      })),
      ...(evidence.artifact ? { artifact:structuredClone(evidence.artifact) } : {}),
      issues
    };
    return { ...context, partSegmentation:summary };
  }
}
