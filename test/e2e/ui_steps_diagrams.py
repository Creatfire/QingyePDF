async def steps(pg, logs):
    ev = pg.evaluate
    S = 'window.qingye.markdown.sessions.values().next().value'
    doc = "# D\\n\\n```sequence\\nTitle: Demo\\nAlice->Bob: Hello Bob, how are you?\\nNote right of Bob: Bob thinks\\nBob-->Alice: I am good thanks!\\n```\\n\\n```flow\\nst=>start: Start\\nop=>operation: Your Operation\\ncond=>condition: Yes or No?\\ne=>end\\nst->op->cond\\ncond(yes)->e\\ncond(no)->op\\n```\\n"
    await ev(f'{S}.editor.replaceAll("{doc}")')
    await pg.wait_for_timeout(4000)
    print(await ev('[...document.querySelectorAll(".mdMermaid")].map(b=>b.dataset.kind+":"+b.dataset.state+":"+!!b.querySelector("svg")+":"+(b.querySelector(".mdMermaidError")?.textContent||"")).join(" | ")'))
    await pg.screenshot(path='/tmp/t/diag.png')
