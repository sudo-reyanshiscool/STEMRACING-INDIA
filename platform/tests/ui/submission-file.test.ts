// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest';
import {readSubmissionFile} from '../../src/ui/submission-file';
import {validateSubmission,submissionErrorText} from '../../src/ui/submission-errors';
import {ApiError} from '../../src/api';
afterEach(()=>vi.useRealTimers());
it('reads actual browser files as exact base64 bytes using FileReader',async()=>{
 const bytes=new Uint8Array([0,255,128,13,10,70]);const file=new File([bytes],'model.obj',{type:'application/octet-stream'});
 expect(await readSubmissionFile(file,100)).toBe(btoa(String.fromCharCode(...bytes)));
});
it('reports empty, oversized and unreadable files with usable local guidance',async()=>{
 await expect(readSubmissionFile(new File([],'empty.obj'),100)).rejects.toThrow(/empty/);
 await expect(readSubmissionFile(new File(['too large'],'large.obj'),1)).rejects.toThrow(/smaller/);
 await expect(readSubmissionFile({size:10,arrayBuffer:async()=>{throw Error('OS error');}} as unknown as File,100)).rejects.toThrow(/could not be read/);
});
it('bounds a stalled file read and tells the user to get a local copy',async()=>{
 vi.useFakeTimers();const result=readSubmissionFile({size:10,arrayBuffer:()=>new Promise(()=>{})} as unknown as File,100);const assertion=expect(result).rejects.toThrow(/in time/);await vi.advanceTimersByTimeAsync(60000);await assertion;
});
it('displays authored validation guidance and diagnostic codes without leaking server messages',()=>{
 let error:unknown;try{validateSubmission(()=>{throw new ApiError('invalid','Render must be 3840 × 2160.');});}catch(e){error=e;}
 expect(submissionErrorText(error)).toContain('3840 × 2160');
 expect(submissionErrorText(new ApiError('unknown','secret SQL internals','54000'))).toContain('54000');
 expect(submissionErrorText(new ApiError('unknown','secret SQL internals','54000'))).not.toContain('secret');
 expect(submissionErrorText(new ApiError('conflict','raw'))).not.toContain('race');
});
