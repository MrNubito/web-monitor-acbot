const os=require('os');
function isPrivateIPv4(address){return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);}
function lanHosts(){return Object.values(os.networkInterfaces()).flat().filter(i=>i.family==='IPv4'&&!i.internal&&isPrivateIPv4(i.address)).map(i=>i.address);}
module.exports={lanHosts,isPrivateIPv4};
