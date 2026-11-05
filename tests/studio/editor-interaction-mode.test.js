import { describe,it,expect,vi } from 'vitest';
import { EditorController } from '../../apps/studio/editor/EditorController.js';
import { useStudioStore } from '../../apps/studio/react/state/studioStore.ts';

function editorFixture(){
  const editor=Object.create(EditorController.prototype);
  let selection=null;
  editor.getSelection=()=>selection;
  editor.setSelection=value=>{selection=value;};
  const object={};
  editor.runtime={store:{get:()=>({object})},events:{emit:vi.fn()},mutate:vi.fn()};
  editor.transform={attach:vi.fn(),detach:vi.fn(),setMode:vi.fn(),dragging:false};
  editor.box={setFromObject:vi.fn(),visible:false};
  return {editor,object};
}
describe('exploration and editing',()=>{
  it('keeps selection/highlight while attaching transforms only in edit mode',()=>{
    const {editor,object}=editorFixture();
    editor.setInteractionMode('explore');editor.select('cup');
    expect(editor.selectedId).toBe('cup');expect(editor.box.visible).toBe(true);
    expect(editor.transform.attach).not.toHaveBeenCalled();
    editor.setInteractionMode('edit');expect(editor.transform.attach).toHaveBeenCalledWith(object);
    editor.setInteractionMode('explore');expect(editor.transform.enabled).toBe(false);
    expect(editor.selectedId).toBe('cup');
  });
  it('blocks editing commands during exploration',async()=>{
    const {editor}=editorFixture();editor.setInteractionMode('explore');editor.select('cup');
    editor.setMode('rotate');await editor.duplicateSelected();editor.deleteSelected();
    expect(editor.runtime.mutate).not.toHaveBeenCalled();expect(editor.transform.setMode).not.toHaveBeenCalled();
    expect(editor.selectedId).toBe('cup');
  });
  it('preserves mode across inspector updates without opening the panel',()=>{
    const previous=useStudioStore.getState();
    try {
      previous.closeContext();previous.setInteractionMode('edit');previous.setSelection({source:'environment',id:'door'});
      previous.syncInspector(null);expect(useStudioStore.getState().editor.interactionMode).toBe('edit');
      expect(useStudioStore.getState().editor.selection).toEqual({source:'environment',id:'door'});
      expect(useStudioStore.getState().layout.contextOpen).toBe(false);
    } finally {useStudioStore.setState(previous);}
  });
});

it('environment and authoring selections share events but cannot acquire runtime transform controls',()=>{
 const {editor,object}=editorFixture();editor.runtime.environment={interactions:[{contractId:'door',object}]};
 editor.setInteractionMode('edit');editor.selectSelection({source:'environment',id:'door'});
 expect(editor.runtime.events.emit).toHaveBeenLastCalledWith('editor.selection',{id:null,selection:{source:'environment',id:'door'}});
 expect(editor.box.visible).toBe(true);expect(editor.transform.attach).not.toHaveBeenCalled();
 editor.selectSelection({source:'authoring',id:'wall'});
 expect(editor.runtime.events.emit).toHaveBeenLastCalledWith('editor.selection',{id:null,selection:{source:'authoring',id:'wall'}});
 editor.select(null);expect(editor.selection).toBeNull();expect(editor.box.visible).toBe(false);
});
