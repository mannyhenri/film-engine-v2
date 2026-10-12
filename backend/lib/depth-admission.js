const failure=message=>Object.assign(new Error(message),{status:422});
// Match NumPy/Python ties-to-even rounding used by the pinned VDA Resize helper.
function nearestEven(value){const whole=Math.floor(value),fraction=value-whole;return fraction===0.5?(whole%2?whole+1:whole):Math.round(value);}
function vdaModelGrid(width,height,inputSize){
 const ratio=Math.max(width,height)/Math.min(width,height);
 let effective=inputSize;
 if(ratio>1.78)effective=nearestEven(Math.trunc(inputSize*1.777/ratio)/14)*14;
 if(effective<14)throw failure('Model grid is too small for this source aspect ratio');
 const scale=Math.max(effective/width,effective/height);
 const constrain=value=>{let n=nearestEven(value/14)*14;if(n<effective)n=Math.ceil(value/14)*14;return n;};
 const w=constrain(scale*width),h=constrain(scale*height);
 return {width:w,height:h,pixels:w*h,effective_model_input_size:effective};
}
function validateAdmission(descriptor,request){
 const {width,height,timing,settings}=request,pixels=width*height,rawBytes=pixels*timing.frame_count*4;
 if(!Number.isSafeInteger(rawBytes)||rawBytes<1)throw failure('Unsafe depth output allocation');
 if(width>descriptor.max_width||height>descriptor.max_height||timing.frame_count>descriptor.max_frames)throw failure('Configured worker cannot preserve this requested range and resolution');
 if(descriptor.max_output_pixels!=null&&pixels>descriptor.max_output_pixels)throw failure('Depth output pixels exceed worker limit; review a smaller source asset or preview');
 if(descriptor.max_raw_bytes!=null&&rawBytes>descriptor.max_raw_bytes)throw failure('Raw depth exceeds worker byte limit; choose a shorter range or smaller source asset');
 const duration=timing.duration_ticks*timing.time_base.numerator/timing.time_base.denominator;
 if(descriptor.max_duration_seconds!=null&&duration>descriptor.max_duration_seconds)throw failure('Depth range exceeds worker duration limit; choose a shorter range');
 if(descriptor.max_source_pixels!=null&&(timing.width*timing.height>descriptor.max_source_pixels||Math.max(timing.width,timing.height)>8192))throw failure('Source geometry exceeds audited local depth limits');
 let grid;
 if(descriptor.max_model_pixels!=null){
  const swapped=Math.abs(timing.display_rotation_degrees??0)===90;
  grid=vdaModelGrid(swapped?timing.height:timing.width,swapped?timing.width:timing.height,settings.model_input_size);
  if(grid.pixels>descriptor.max_model_pixels)throw failure('Internal model grid exceeds worker limit; reduce model input size');
 }
 return {output_pixels:pixels,raw_bytes:rawBytes,duration_seconds:duration,...(grid?{model_grid:grid}:{})};
}
module.exports={vdaModelGrid,validateAdmission};
