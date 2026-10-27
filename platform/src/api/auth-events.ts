/** Refreshing a token or refocusing a tab must not discard a form or an in-flight upload. */
export function authSessionFingerprint(session:{user:{id:string;email?:string|null};access_token?:string}|null):string {
 if(!session)return 'signed-out';
 let assurance:string|null=null;
 try{const payload=session.access_token?.split('.')[1];if(payload){const claims=JSON.parse(atob(payload.replace(/-/g,'+').replace(/_/g,'/')));if(claims.aal==='aal1'||claims.aal==='aal2')assurance=claims.aal;}}catch{/* Invalid tokens are rejected by the auth client; this only controls UI refreshes. */}
 return JSON.stringify([session.user.id,(session.user.email??'').toLowerCase(),assurance]);
}
