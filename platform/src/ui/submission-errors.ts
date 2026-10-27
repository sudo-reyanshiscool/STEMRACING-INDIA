import {ApiError} from '../api';
import {errorText} from './common';
/** Only errors from our own preflight validation may display their original wording. */
export class SubmissionValidationError extends Error {}
export function validateSubmission<T>(check:()=>T):T {
 try{return check();}catch(err){if(err instanceof ApiError&&err.code==='invalid')throw new SubmissionValidationError(err.message);throw err;}
}
export function submissionErrorText(err:unknown):string {
 if(err instanceof SubmissionValidationError)return err.message;
 if(err instanceof ApiError){
  if(err.code==='network')return 'The upload could not be confirmed. Your file stays selected. Refresh the saved status before trying again.';
  if(err.code==='conflict')return 'This submission changed. Refresh its saved status before replacing the file.';
  if(err.code==='locked')return 'Submissions are locked for this event. Refresh the page to check its status.';
  if(/statement timeout|canceling statement|57014/i.test(err.message))return 'The server timed out before confirming this upload. Refresh the saved status before trying again.';
  if(/request entity too large|payload too large|\b413\b/i.test(err.message))return 'The server rejected the upload size. Your file has not been confirmed as submitted.';
  if(err.code==='unknown'&&err.detailCode&&/^(?:[0-9A-Z]{5}|PGRST[0-9]+)$/.test(err.detailCode))return `The server could not confirm this upload (code ${err.detailCode}). Your selected file is still available to retry.`;
  if(err.code==='invalid'&&/invalid or incomplete image/i.test(err.message))return 'The image could not be read. Export a fresh JPG or PNG and try again.';
 }
 return errorText(err);
}
