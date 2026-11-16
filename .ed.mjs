import fs from "node:fs";
function edit(p, pairs){ let s=fs.readFileSync(p,"utf8"); for(const [a,b] of pairs){ if(!s.includes(a)) throw new Error(a); s=s.split(a).join(b);} fs.writeFileSync(p,s); }
edit("components/landing/landing-page.tsx",[
['<p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{intro}</p>','<p className="mt-1 max-w-prose text-base leading-relaxed text-muted-foreground">{intro}</p>'],
['<p className="text-xs text-muted-foreground">\n          Needs','<p className="text-sm text-muted-foreground">\n          Needs'],
['<TileGrid className="grid-cols-2 lg:grid-cols-4">','<TileGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">'],
['<span className="text-xs text-muted-foreground max-sm:line-clamp-2">{text}</span>','<span className="text-sm leading-relaxed text-muted-foreground">{text}</span>'],
['<p className="text-xs text-muted-foreground">\n        Checked','<p className="max-w-prose text-sm leading-relaxed text-muted-foreground">\n        Checked'],
['<TileGrid className="grid-cols-1">\n        {agentSkills','<TileGrid className="grid-cols-1 md:grid-cols-2">\n        {agentSkills'],
['<span className="text-xs text-muted-foreground">{text}</span>','<span className="text-sm leading-relaxed text-muted-foreground">{text}</span>'],
['<TileGrid className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-2">','<TileGrid className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">'],
['      <div className={pair}>\n        <NewPanel />\n        <PerfPanel />\n      </div>','      <NewPanel />\n      <PerfPanel />'],
['      <div className={pair}>\n        <AgentsPanel />\n        <AddOnsPanel />\n      </div>','      <AgentsPanel />\n      <AddOnsPanel />'],
['const pair = "grid items-start gap-4 lg:grid-cols-2";\n\n',''],
]);
edit("components/landing/parts.tsx",[
['<ul className="grid gap-px border bg-border sm:grid-cols-3">','<ul className="grid gap-px border bg-border lg:grid-cols-3">'],
['<span className="text-sm font-medium">{s.title}</span>\n              <span className="text-xs text-muted-foreground">{s.detail}</span>\n              <span className="text-xs underline','<span className="text-base font-medium">{s.title}</span>\n              <span className="text-sm leading-relaxed text-muted-foreground">{s.detail}</span>\n              <span className="text-sm underline'],
['<p className="mt-2 text-xs text-muted-foreground">','<p className="mt-3 text-sm leading-relaxed text-muted-foreground">'],
['<ul className="grid grid-cols-2 gap-px border bg-border lg:grid-cols-3">','<ul className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-3">'],
['<span className="text-xs text-muted-foreground">{h.text}</span>','<span className="text-sm leading-relaxed text-muted-foreground">{h.text}</span>'],
]);
