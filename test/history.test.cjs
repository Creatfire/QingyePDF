const test=require('node:test');const assert=require('node:assert/strict');
test('document history restores byte snapshots, discards redo branches and bounds retained memory',async()=>{
  const {createHistory}=await import('../ui/history.mjs');const h=createHistory(16),bytes=n=>new Uint8Array(4).fill(n);
  h.push(bytes(0),bytes(1),'delete');h.push(bytes(1),bytes(2),'outline');assert.equal(h.undo()[0],1);assert.equal(h.redo()[0],2);h.undo();h.push(bytes(1),bytes(3),'stamp');assert.equal(h.canRedo,false);assert.equal(h.rows[1].label,'stamp');h.push(bytes(3),bytes(4),'rotate');assert.equal(h.rows.length,2);assert.equal(h.undo()[0],3);assert.equal(h.undo()[0],1);assert.equal(h.undo(),null);
});
