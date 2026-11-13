import { booleanPaths, type BooleanOperation, type SketchPath } from '@aether/sketch';
import { dividePaths } from './vector';
self.onmessage=(event: MessageEvent<{paths:SketchPath[];operation:BooleanOperation|'divide';tolerance:number}>)=>{
  try {const {paths,operation,tolerance}=event.data;self.postMessage(operation==='divide'?{pieces:dividePaths(paths,tolerance)}:{path:booleanPaths(paths,operation,tolerance)});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:'The Boolean could not be completed.'});}
};
