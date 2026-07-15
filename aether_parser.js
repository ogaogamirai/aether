// Aether DSL Parser & Serializer v4.0 (export format header remains v3.0)

// Aether DSL Parser
function parseAetherDSL(text) {
  const parsedNotes = [];
  const parsedConns = [];
  const parsedDrawings = [];
  const parsedRelations = [];
  const lines = text.split('\n');
  
  let currentSticky = null;
  let currentDrawing = null;
  let currentRelation = null;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    // Sticky notes parsing
    if (line.startsWith('sticky')) {
      const match = line.match(/^sticky\s+(\w+)\s+"([^"]+)"\s*\{/);
      if (match) {
        currentSticky = {
          id: match[1],
          content: match[2],
          color: 'yellow',
          x: 100 + Math.random() * 200,
          y: 100 + Math.random() * 200,
          tags: [],
          desc: '',
          time: '',
          tone: ''
        };
      }
      continue;
    }

    // Drawing shapes parsing (with Approach A)
    if (line.startsWith('drawing')) {
      const match = line.match(/^drawing\s+(\w+)\s+"([^"]+)"\s*\{/);
      if (match) {
        currentDrawing = {
          id: match[1],
          title: match[2],
          type: 'arc-up',
          from: '',
          to: '',
          style: 'solid',
          color: 'blue',
          targets: [],
          anchor: '',
          offset: [0, 0],
          pos: [100, 100],
          tags: [],
          time: ''
        };
      }
      continue;
    }

    // Relation blocks parsing (New in v3.0)
    if (line.startsWith('relation')) {
      const match = line.match(/^relation\s+(\w+)\s*->\s*(\w+)\s*\{/);
      if (match) {
        currentRelation = {
          from: match[1],
          to: match[2],
          type: 'default',
          label: '',
          color: 'blue',
          tags: [],
          time: ''
        };
      }
      continue;
    }

    // Handle properties
    if (currentSticky) {
      if (line === '}') {
        parsedNotes.push(currentSticky);
        currentSticky = null;
        continue;
      }

      const propMatch = line.match(/^(\w+):\s*(.+)$/);
      if (propMatch) {
        const prop = propMatch[1];
        let val = propMatch[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1);
        }
        if (prop === 'pos') {
          const coords = val.split(/\s+/).map(Number);
          if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
            currentSticky.x = coords[0];
            currentSticky.y = coords[1];
          }
        } else if (prop === 'color') {
          currentSticky.color = val;
        } else if (prop === 'tags') {
          currentSticky.tags = val.split(/\s+/);
        } else if (prop === 'desc') {
          currentSticky.desc = val;
        } else if (prop === 'time') {
          currentSticky.time = val;
        } else if (prop === 'tone') {
          currentSticky.tone = val;
        }
      }
      continue;
    }

    if (currentDrawing) {
      if (line === '}') {
        parsedDrawings.push(currentDrawing);
        currentDrawing = null;
        continue;
      }

      const propMatch = line.match(/^(\w+):\s*(.+)$/);
      if (propMatch) {
        const prop = propMatch[1];
        let val = propMatch[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1);
        }
        if (prop === 'type') currentDrawing.type = val;
        else if (prop === 'from') currentDrawing.from = val;
        else if (prop === 'to') currentDrawing.to = val;
        else if (prop === 'style') currentDrawing.style = val;
        else if (prop === 'color') currentDrawing.color = val;
        else if (prop === 'anchor') currentDrawing.anchor = val;
        else if (prop === 'offset') {
          currentDrawing.offset = val.split(/\s+/).map(Number);
        } else if (prop === 'pos') {
          currentDrawing.pos = val.split(/\s+/).map(Number);
        } else if (prop === 'targets') {
          currentDrawing.targets = val.split(/\s+/);
        } else if (prop === 'tags') {
          currentDrawing.tags = val.split(/\s+/);
        } else if (prop === 'time') {
          currentDrawing.time = val;
        }
      }
      continue;
    }

    if (currentRelation) {
      if (line === '}') {
        parsedRelations.push(currentRelation);
        currentRelation = null;
        continue;
      }

      const propMatch = line.match(/^(\w+):\s*(.+)$/);
      if (propMatch) {
        const prop = propMatch[1];
        let val = propMatch[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1);
        }
        if (prop === 'type') currentRelation.type = val;
        else if (prop === 'label') currentRelation.label = val;
        else if (prop === 'color') currentRelation.color = val;
        else if (prop === 'tags') currentRelation.tags = val.split(/\s+/);
        else if (prop === 'time') currentRelation.time = val;
      }
      continue;
    }

    // Connection line parsing (Fallback connection)
    const connMatch = line.match(/^(\w+)\s*->\s*(\w+)$/);
    if (connMatch) {
      parsedConns.push({
        source: connMatch[1],
        target: connMatch[2]
      });
    }
  }

  return { 
    notes: parsedNotes, 
    connections: parsedConns, 
    drawings: parsedDrawings, 
    relations: parsedRelations 
  };
}

// Generate DSL representation from current canvas state (pure, DOM-free)
function serializeCanvasToDSL() {
  let dsl = '# Aether DSL Export v3.0\n\n';

  notes.forEach(note => {
    dsl += `sticky ${note.id} "${note.content}" {\n`;
    dsl += `  pos: ${Math.round(note.x)} ${Math.round(note.y)}\n`;
    dsl += `  color: "${note.color}"\n`;
    if (note.tags && note.tags.length > 0) {
      dsl += `  tags: "${note.tags.join(' ')}"\n`;
    }
    if (note.desc) {
      dsl += `  desc: "${note.desc}"\n`;
    }
    if (note.time) {
      dsl += `  time: "${note.time}"\n`;
    }
    if (note.tone) {
      dsl += `  tone: "${note.tone}"\n`;
    }
    dsl += `}\n\n`;
  });

  drawings.forEach(dw => {
    dsl += `drawing ${dw.id} "${dw.title}" {\n`;
    dsl += `  type: "${dw.type}"\n`;
    if (dw.from) dsl += `  from: "${dw.from}"\n`;
    if (dw.to) dsl += `  to: "${dw.to}"\n`;
    if (dw.style) dsl += `  style: "${dw.style}"\n`;
    if (dw.color) dsl += `  color: "${dw.color}"\n`;
    if (dw.anchor) dsl += `  anchor: "${dw.anchor}"\n`;
    if (dw.offset) dsl += `  offset: ${dw.offset[0]} ${dw.offset[1]}\n`;
    if (dw.pos && !dw.anchor) dsl += `  pos: ${dw.pos[0]} ${dw.pos[1]}\n`;
    if (dw.targets.length > 0) dsl += `  targets: "${dw.targets.join(' ')}"\n`;
    if (dw.tags && dw.tags.length > 0) {
      dsl += `  tags: "${dw.tags.join(' ')}"\n`;
    }
    if (dw.time) {
      dsl += `  time: "${dw.time}"\n`;
    }
    dsl += `}\n\n`;
  });

  // Export Semantic Relations
  relations.forEach(rel => {
    dsl += `relation ${rel.from} -> ${rel.to} {\n`;
    dsl += `  type: "${rel.type}"\n`;
    if (rel.label) dsl += `  label: "${rel.label}"\n`;
    if (rel.color) dsl += `  color: "${rel.color}"\n`;
    if (rel.tags && rel.tags.length > 0) {
      dsl += `  tags: "${rel.tags.join(' ')}"\n`;
    }
    if (rel.time) {
      dsl += `  time: "${rel.time}"\n`;
    }
    dsl += `}\n\n`;
  });

  if (connections.length > 0) {
    dsl += '# Fallback Connections\n';
    connections.forEach(conn => {
      dsl += `${conn.source} -> ${conn.target}\n`;
    });
  }

  return dsl;
}

// Compatibility wrapper with DOM side effects (button onclick)
function generateDSLFromCanvas() {
  const dsl = serializeCanvasToDSL();
  const input = document.getElementById('dsl-input');
  if (input) input.value = dsl;
  if (typeof switchTab === 'function') switchTab('dsl');
}
