const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'final-review-real-store-'));
process.env.FILM_DATA_DIR=temp;
const {db}=require('../db/database');require('../db/schema').ensureSchema();
const contract=require('../lib/final-request-review');
require('../lib/providers/credentials').getCredential=()=>({apiKey:'mock-only',meta:{}});
const openai=require('../lib/providers/openai-image').adapter;
test.after(()=>{db.close();fs.rmSync(temp,{recursive:true,force:true});});
