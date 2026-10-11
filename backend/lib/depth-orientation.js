const failure=message=>Object.assign(new Error(message),{status:422});
function canonicalRotation(value=0){
 const angle=Number(value);
 if(!Number.isFinite(angle)||Math.abs(angle/90-Math.round(angle/90))>0.001)throw failure('Depth supports only quarter-turn display rotation');
 const turns=((Math.round(angle/90)%4)+4)%4;
 return (turns===3?-1:turns)*90;
}
function orientationFor(width,height,rotation=0){
 const angle=canonicalRotation(rotation),swapped=Math.abs(angle)===90;
 return {coded_width:width,coded_height:height,display_width:swapped?height:width,
  display_height:swapped?width:height,display_rotation_degrees:angle,output_coordinates:'encoded'};
}
function readMatrix(side,width,height){
 const angle=canonicalRotation(side.rotation);
 if(typeof side.displaymatrix!=='string')throw failure('Missing source display matrix');
 const rows=side.displaymatrix.trim().split('\n').map(line=>line.split(':')[1]?.trim().split(/\s+/).map(Number));
 if(rows.length!==3||rows.some(row=>!row||row.length!==3||row.some(v=>!Number.isSafeInteger(v))))throw failure('Invalid source display matrix');
 const radians=angle*Math.PI/180,c=Math.round(Math.cos(radians))*65536,s=Math.round(Math.sin(radians))*65536;
 const expected=[c,-s,0,s,c,0,0,0,1073741824];
 // Phone display matrices may translate the rotated rectangle into positive
 // display coordinates. Accept only that exact geometry, or the zero-origin
 // form used by FFmpeg; arbitrary translation, mirror and scale still fail.
 const translation={0:[0,0],90:[0,width*65536],180:[width*65536,height*65536],'-90':[height*65536,0]}[angle];
 const flat=rows.flat();
 if(flat[6]!==0||flat[7]!==0){
  if(!Number.isSafeInteger(width)||width<1||!Number.isSafeInteger(height)||height<1||!translation||flat[6]!==translation[0]||flat[7]!==translation[1])throw failure('Mirrored, scaled or nonstandard source display matrix is unsupported');
  expected[6]=translation[0];expected[7]=translation[1];
 }
 if(rows.flat().some((n,i)=>n!==expected[i]))throw failure('Mirrored, scaled or nonstandard source display matrix is unsupported');
 return angle;
}
function probeRotation(stream,frames=[]){
 const matrices=(stream.side_data_list||[]).filter(side=>side.side_data_type==='Display Matrix');
 if(matrices.length>1)throw failure('Multiple source display matrices are unsupported');
 const angle=matrices.length?readMatrix(matrices[0],stream.width,stream.height):canonicalRotation(stream.tags?.rotate??0);
 if(matrices.length&&stream.tags?.rotate!=null&&canonicalRotation(stream.tags.rotate)!==angle)throw failure('Conflicting source display rotations');
 for(const frame of frames)for(const side of frame.side_data_list||[])if(side.side_data_type==='Display Matrix'&&readMatrix(side,stream.width,stream.height)!==angle)throw failure('Changing source display rotation is unsupported');
 return angle;
}
function validateWorkerOrientation(timing,reported){
 const expected=orientationFor(timing.width,timing.height,timing.display_rotation_degrees??0);
 if(reported!==undefined){
  if(!reported||typeof reported!=='object')throw failure('Worker orientation is invalid');
  for(const key of Object.keys(expected))if(reported[key]!==expected[key])throw failure('Worker orientation does not match the reviewed source');
 }
 return expected;
}
module.exports={canonicalRotation,orientationFor,probeRotation,validateWorkerOrientation};
