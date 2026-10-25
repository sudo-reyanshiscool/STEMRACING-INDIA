import {vi} from 'vitest';
import {SUBMISSION_GUIDE_DURATION,type Api} from '../src/api';
/** Simulate normal-speed guide playback for fixtures that test a subsequent upload flow. */
export async function watchGuide(api:Api,eventId:string) {
  let now=Date.now();
  const time=vi.spyOn(Date,'now').mockImplementation(()=>now);
  try {
    await api.recordSubmissionGuideProgress(eventId,0);
    for(let position=10;position<SUBMISSION_GUIDE_DURATION;position+=10){now+=10000;await api.recordSubmissionGuideProgress(eventId,position);}
    now+=10000;await api.recordSubmissionGuideProgress(eventId,SUBMISSION_GUIDE_DURATION);
  }finally{time.mockRestore();}
}
