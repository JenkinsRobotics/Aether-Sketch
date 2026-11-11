import {updates} from './updates';
import { ApplicationHome } from '@aether/session/home';
import type { AppHomeDefinition } from '@aether/session/home/types';
import { createDocument } from '../create-document';

export const homeDefinition: AppHomeDefinition = {updates,brand:"Aether Sketch",appIcon:"sketch",appUrl:"./index.html",accept:".aethersketch",uploadPattern:/\.aethersketch$/i,uploadHint:"Import an .aethersketch drawing.",heroLead:"Draw shapes, edit paths, and bring your next idea to the canvas.",emptyHint:"Create a sketch to get started.",fallbackIcon:"document",types:[{id:"sketch",label:"Sketches",icon:"document",test:/\.aethersketch$/i}],menu:[["sketch","Sketch","document"],["folder","Folder","file-folder"],["import","Import file…","import"]],start:[{kind:"sketch",title:"Sketch",tagline:"Create paths, shapes and illustrations",icon:"document",action:"new-doc"}],create:async(_kind,name,{storage,destination})=>storage.createFile(await createDocument(name),destination),
};
export function Home(){return <ApplicationHome definition={homeDefinition}/>;}
