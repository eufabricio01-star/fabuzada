export const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:3001/api';
export const SOCKET=process.env.NEXT_PUBLIC_SOCKET_URL||'http://localhost:3001';
export const getToken=()=>typeof window==='undefined'?'':localStorage.getItem('fabuzada_token')||'';
export async function api(path:string,method='GET',data?:any):Promise<any>{const r=await fetch(API+path,{method,headers:{'Content-Type':'application/json',...(getToken()?{Authorization:'Bearer '+getToken()}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{}),cache:'no-store'});const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||'Erro de conexão');return body}
export const time=(v:string)=>new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
