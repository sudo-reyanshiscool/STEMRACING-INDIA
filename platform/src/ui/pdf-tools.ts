/** A deployment may replace the files referenced by a page that was left open. */
export class PdfToolsLoadError extends Error {
 constructor(cause:unknown){super('The PDF tools could not load. The website may have updated, or the connection was interrupted. Reload the website and try again.',{cause});}
}

export async function loadPdfReports(){
 try{return await import('../pdf/resultReports');}
 catch(error){throw new PdfToolsLoadError(error);}
}
export async function loadResultsArchive(){
 try{return await import('../pdf/resultsArchive');}
 catch(error){throw new PdfToolsLoadError(error);}
}
