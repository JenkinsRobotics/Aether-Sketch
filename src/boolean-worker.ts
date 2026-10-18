import { booleanPaths, type BooleanOperation, type SketchPath } from '@aether/sketch';
self.onmessage=(event: MessageEvent<{paths:SketchPath[];operation:BooleanOperation;tolerance:number}>)=>{
  try {const {paths,operation,tolerance}=event.data;self.postMessage({path:booleanPaths(paths,operation,tolerance)});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:'The Boolean could not be completed.'});}
};
