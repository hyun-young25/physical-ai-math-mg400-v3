const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function evaluate(source, deps = {}) {
  const exports = {};
  new Function(
    "exports",
    "require",
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText,
  )(exports, (name) => {
    assert.ok(name in deps, name);
    return deps[name];
  });
  return exports;
}
const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");
const curriculum = evaluate(read("curriculum.ts"));
const design = evaluate(read("pickPlaceDesign.ts"), {
  "./curriculum": curriculum,
});
const fk = evaluate(read("fkLearning.ts"));
// Use the application's actual FK/IK definitions, not an idealized replacement.
const app = ts.createSourceFile(
  "App.tsx",
  read("App.tsx"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const declarations = app.statements
  .filter(
    (s) =>
      (ts.isFunctionDeclaration(s) &&
        ["fkMG400", "ikMG400"].includes(s.name?.text)) ||
      (ts.isVariableStatement(s) &&
        s.declarationList.declarations.some((d) =>
          ["ARM_L1", "COORD_OX", "COORD_OZ"].includes(d.name.getText(app)),
        )),
  )
  .map((s) => s.getText(app))
  .join("\n");
const core = evaluate(
  declarations + "\nexport {fkMG400,ikMG400,COORD_OX,COORD_OZ};",
);
const model = {
  fk(j) {
    const p = core.fkMG400(j.j1, j.j2, j.j3);
    return { x: p.x + core.COORD_OX, y: p.y, z: p.z + core.COORD_OZ, r: j.j4 };
  },
  ik(x, y, z, r, hint) {
    const j = core.ikMG400(x - core.COORD_OX, y, z - core.COORD_OZ, hint);
    return j && { ...j, j4: r };
  },
};
function program(
  condition,
  mode = "absolute",
  height = condition.clearance + 20,
) {
  let previous = condition.start;
  const move = (target, step) => {
    const command = {
      ...design.blankDesignCommand("move"),
      mode: mode === "mixed" ? (step % 2 ? "relative" : "absolute") : mode,
      motion: "MoveL",
    };
    command.values = Object.fromEntries(
      ["x", "y", "z"].map((k) => [
        k,
        String(target[k] - (command.mode === "relative" ? previous[k] : 0)),
      ]),
    );
    previous = target;
    return command;
  };
  return [
    move(condition.pick, 0),
    design.blankDesignCommand("grip"),
    move({ ...condition.pick, z: height }, 1),
    move({ ...condition.place, z: height }, 2),
    move(condition.place, 3),
    design.blankDesignCommand("release"),
    move({ ...condition.place, z: condition.place.z + 20 }, 4),
  ];
}
const run = (commands, condition = design.DESIGN_CONDITIONS[0], r = 76) =>
  design.compileDesign(model, condition, commands, r, -90);

test("absolute, relative and mixed student plans all complete both changed conditions with preserved R", () => {
  for (const c of design.DESIGN_CONDITIONS)
    for (const mode of ["absolute", "relative", "mixed"])
      for (const extra of [20, 40]) {
        const commands = program(c, mode, c.clearance + extra),
          before = JSON.stringify(commands),
          result = run(commands, c);
        assert.equal(
          design.designSyntax(
            commands,
            String(c.clearance + extra),
            "높이와 도착 위치를 구분했다.",
          ),
          null,
        );
        assert.equal(result.outcome.finished, true);
        assert.deepEqual(
          design.judgeDesign(result.outcome, String(c.clearance + extra)),
          [],
          mode,
        );
        assert.ok(design.designNear(result.outcome.object, c.place));
        assert.ok(result.frames.every((f) => f.pose.r === 76));
        assert.equal(JSON.stringify(commands), before);
        assert.deepEqual(
          result.outcome.final,
          model.fk(result.frames.at(-1).joints),
        );
      }
});
test("relative moves use the latest actual FK endpoint and never substitute a target answer", () => {
  const c = design.DESIGN_CONDITIONS[1],
    commands = program(c, "relative");
  commands[4].values.z = "40"; // Mistake: absolute destination entered as relative change.
  const result = run(commands, c),
    descent = result.outcome.observations[4];
  assert.equal(descent.target.z, descent.from.z + 40);
  assert.ok(Math.abs(result.outcome.object.z - c.place.z) > 50);
  assert.ok(result.outcome.issues.some((i) => i.concept === "reference"));
  assert.ok(result.outcome.issues.some((i) => i.concept === "path"));
});
test("grip before arrival does not attach the object or invent a successful carry", () => {
  const commands = program(design.DESIGN_CONDITIONS[0]);
  [commands[0], commands[1]] = [commands[1], commands[0]];
  const result = run(commands);
  assert.ok(result.outcome.issues.some((i) => i.concept === "sequence"));
  assert.equal(result.outcome.maxHeldZ, null);
  assert.ok(result.frames.every((f) => !f.attached));
  assert.ok(
    design.designNear(result.outcome.object, design.DESIGN_CONDITIONS[0].pick),
  );
});
test("actual low carry and a non-MoveL descent report distinct failed relations", () => {
  const c = design.DESIGN_CONDITIONS[0],
    commands = program(c, "absolute", 40);
  commands[4].motion = "MoveJ";
  const result = run(commands);
  assert.ok(
    result.outcome.issues.some((i) => i.concept === "height" && i.step === 3),
  );
  assert.ok(
    result.outcome.issues.some((i) => i.concept === "path" && i.step === 5),
  );
  assert.ok(design.designNear(result.outcome.object, c.place));
});
test("a missing release or retreat is not task completion even when all commands execute", () => {
  const commands = program(design.DESIGN_CONDITIONS[0]);
  assert.ok(
    run(commands.slice(0, 5)).outcome.issues.some(
      (i) => i.concept === "sequence",
    ),
  );
  assert.ok(
    run(commands.slice(0, 6)).outcome.issues.some(
      (i) => i.concept === "height",
    ),
  );
});
test("unreachable moves stop at the valid prefix without fabricated later observations", () => {
  for (const index of [0, 3]) {
    const commands = program(design.DESIGN_CONDITIONS[0]);
    commands[index].values.x = "5000";
    const result = run(commands);
    assert.equal(result.outcome.finished, false);
    assert.equal(result.outcome.observations.length, index);
    assert.ok(result.frames.every((f) => f.step < index));
    assert.ok(result.outcome.issues.some((i) => i.concept === "reach"));
  }
});
test("highest held-object height excludes the empty suction cup retreat", () => {
  const commands = program(design.DESIGN_CONDITIONS[0]);
  commands[6].values.z = "160";
  const result = run(commands);
  assert.deepEqual(design.judgeDesign(result.outcome, "80"), []);
  assert.ok(
    design
      .judgeDesign(result.outcome, "160")
      .some((i) => i.concept === "prediction"),
  );
  assert.ok(result.outcome.final.z > result.outcome.maxHeldZ + 70);
});
test("blank and non-finite command inputs remain incomplete while zero is valid", () => {
  const commands = program(design.DESIGN_CONDITIONS[0]);
  for (const bad of ["", "NaN", "Infinity"]) {
    commands[0].values.z = bad;
    assert.notEqual(design.designSyntax(commands, "80", "근거"), null);
  }
  commands[0].values.z = "0";
  assert.equal(design.designSyntax(commands, "80", "근거"), null);
  assert.notEqual(design.designSyntax(commands, "", "근거"), null);
  assert.notEqual(design.designSyntax(commands, "80", ""), null);
  assert.notEqual(design.designSyntax([], "80", "근거"), null);
});
test("FK transfer varies positional joints before J4-only orientation and uses angle sums", () => {
  assert.deepEqual(fk.fkTrends(model, fk.FK_FIRST, fk.FK_REFERENCE), {
    height: "increase",
    reach: "decrease",
  });
  let previous = fk.FK_FIRST;
  for (let round = 0; round < 3; round++) {
    const next = fk.nextFKJoints(previous, round),
      before = model.fk(previous),
      after = model.fk(next);
    assert.equal(
      Object.keys(next)
        .filter((k) => next[k] !== previous[k])
        .join(""),
      ["j2", "j3", "j4"][round],
    );
    if (round < 2)
      assert.ok(
        Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) >
          1,
      );
    else assert.deepEqual({ ...after, r: before.r }, before);
    previous = next;
  }
  assert.ok(Math.abs(fk.horizontalReach({ j2: 0, j3: 90 }) - 175) < 1e-9);
});
