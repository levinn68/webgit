const API = "https://api.github.com";
function env(n){const v=process.env[n];if(!v)throw Object.assign(new Error(n+" is not configured in Vercel"),{statusCode:503});return v;}
function ep(v){return String(v).split("/").map(encodeURIComponent).join("/");}
async function request(path,options={}){
 const r=await fetch(API+path,{...options,headers:{Accept:"application/vnd.github+json",Authorization:"Bearer "+env("GITHUB_TOKEN"),"X-GitHub-Api-Version":"2022-11-28",...(options.body?{"Content-Type":"application/json"}:{}),...options.headers}});
 const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{};}catch{d={message:raw};}
 if(!r.ok)throw Object.assign(new Error(d.message||"GitHub API error"),{statusCode:r.status===401||r.status===403?502:r.status,details:{githubStatus:r.status,errors:d.errors}});
 return d;
}
export async function listRepos({page=1,perPage=100}={}){const p=new URLSearchParams({per_page:String(Math.min(100,Math.max(1,perPage))),page:String(Math.max(1,page)),sort:"updated"});const d=await request("/user/repos?"+p);return d.map(r=>({id:r.id,name:r.name,full_name:r.full_name,description:r.description,private:r.private,default_branch:r.default_branch,updated_at:r.updated_at,permissions:r.permissions,owner:r.owner.login}));}
export async function createRepo({name,description="",isPrivate=true}){if(!/^[A-Za-z0-9_.-]{1,100}$/.test(name)||name==="."||name==="..")throw Object.assign(new Error("Nama repository tidak valid."),{statusCode:400});return request("/user/repos",{method:"POST",body:JSON.stringify({name,description,private:!!isPrivate,auto_init:true})});}
export async function getRepo({owner,repo}){return request("/repos/"+encodeURIComponent(owner)+"/"+encodeURIComponent(repo));}
export async function pushZip({owner,repo,branch,entries,message,overwrite=true}){
 const rp="/repos/"+encodeURIComponent(owner)+"/"+encodeURIComponent(repo),meta=await request(rp);
 if(meta.archived)throw Object.assign(new Error("Repository archived dan tidak bisa menerima upload."),{statusCode:409});
 if(meta.permissions?.push===false)throw Object.assign(new Error("Akun tidak punya izin push ke repository ini."),{statusCode:403});
 const b=String(branch||meta.default_branch||"main");if(!/^[A-Za-z0-9._/-]+$/.test(b)||b.includes("..")||b.startsWith("/")||b.endsWith("/"))throw Object.assign(new Error("Nama branch tidak valid."),{statusCode:400});
 const ref=rp+"/git/ref/heads/"+ep(b);let parent;
 try{parent=(await request(ref)).object.sha;}catch(e){if(e.statusCode!==404)throw e;if(!meta.default_branch)throw Object.assign(new Error("Repository kosong. Buat repo baru atau inisialisasi default branch terlebih dahulu."),{statusCode:409});parent=(await request(rp+"/git/ref/heads/"+ep(meta.default_branch))).object.sha;if(b!==meta.default_branch){try{await request(rp+"/git/refs",{method:"POST",body:JSON.stringify({ref:"refs/heads/"+b,sha:parent})});}catch(x){if(x.statusCode!==422)throw x;parent=(await request(ref)).object.sha;}}}
 const commitParent=await request(rp+"/git/commits/"+parent),tree=[];
 for(const [path,bytes] of entries){const blob=await request(rp+"/git/blobs",{method:"POST",body:JSON.stringify({content:bytes.toString("base64"),encoding:"base64"})});tree.push({path,mode:"100644",type:"blob",sha:blob.sha});}
 const newTree=await request(rp+"/git/trees",{method:"POST",body:JSON.stringify({base_tree:commitParent.tree.sha,tree})});
 const commit=await request(rp+"/git/commits",{method:"POST",body:JSON.stringify({message:message||"Upload project files",tree:newTree.sha,parents:[parent]})});
 await request(rp+"/git/refs/heads/"+ep(b),{method:"PATCH",body:JSON.stringify({sha:commit.sha,force:false})});
 return{owner,repo,branch:b,files:entries.length,commit:commit.sha,url:"https://github.com/"+owner+"/"+repo+"/tree/"+encodeURIComponent(b)};
}