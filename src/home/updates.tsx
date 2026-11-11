import type {ApplicationUpdate} from '@aether/ui';
import {AppUpdateArtwork} from '@aether/session/home/artwork';
const features = [
  {id:'paths',title:'Find the perfect curve',description:'Draw editable paths, adjust their nodes and organize your artwork into layers.',status:'Available',scene:'paths',color:'#abc6df'},
  {id:'paint',title:'Color with more control',description:'Use gradient fills, stroke styles and clipping groups to refine your vector artwork.',status:'Available',scene:'paint',color:'#efc2a9'},
  {id:'brushes',title:'A more expressive brush',description:'Pressure-sensitive raster brushes, textured paint and image layers are planned. Today’s Pencil creates editable vector paths.',status:'Planned',scene:'paint',color:'#b7cfb2'},
 ];
export const updates:ApplicationUpdate[] = features.map(({scene,...item})=>({...item,status:item.status as ApplicationUpdate['status'],artwork:<AppUpdateArtwork scene={scene as Parameters<typeof AppUpdateArtwork>[0]['scene']}/>}));
