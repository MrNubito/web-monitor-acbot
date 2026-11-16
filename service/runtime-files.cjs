const fs=require('fs'),path=require('path'),crypto=require('crypto');
function copyRuntimeFile(source,target){
 const content=fs.readFileSync(source);try{if(fs.readFileSync(target).equals(content))return false;}catch(error){if(error.code!=='ENOENT')throw error;}
 fs.mkdirSync(path.dirname(target),{recursive:true});const temporary=target+'.copy-'+crypto.randomBytes(8).toString('hex');
 try{fs.writeFileSync(temporary,content,{flag:'wx'});fs.renameSync(temporary,target);}finally{try{fs.unlinkSync(temporary);}catch{}}
 return true;
}
module.exports={copyRuntimeFile};
