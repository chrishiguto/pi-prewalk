# pi-prewalk

todo-gated policy for [pi](https://github.com/earendil-works/pi) that lets a strong model establish an implementation trajectory, record a bounded todo list, and make the first concrete mutation before a cheaper model continues the same session.

## why this exists

a cheap model executes well once the hard part is already done: reading the task, picking an approach, and committing to a plan. prewalk keeps the expensive model in the seat exactly that long: it plans, writes the todo list, lands the first successful edit, and then hands the same session to the configured target model. no new session, no summary handoff, no lost context.

the package contains two internal modules:

- **prewalk policy:** owns the planning prompt, todo gate, first-mutation gate, continuation prompt, and verification checklist.
- **trajectory router:** applies a safe, persistent model and thinking-level transition without creating a session, changing branches, rewriting messages, or changing tools.

prewalk calls the router through a direct typed interface. no separate router extension is required.

## install

requires node 22.19+, pi `@earendil-works/pi-coding-agent` 0.84.3+, and authenticated planner and target models in pi.

add the package to `~/.pi/agent/settings.json`:

```jsonc
{
  "packages": ["git:github.com/chrishiguto/pi-prewalk"]
}
```

or use a local checkout:

```jsonc
{
  "packages": ["/path/to/pi-prewalk"]
}
```

## use

select the strong planner model, arm prewalk, then submit the task normally. arming does not start a model turn; it applies to the next task:

```text
/model
/prewalk [provider/model|unique-model-id] [off|minimal|low|medium|high|xhigh|max]
> describe the implementation task here
```

for example:

```text
/prewalk opencode-go/qwen3.8-flash medium
> fix authentication timeout handling and add focused coverage
```

inspect or cancel an armed run:

```text
/prewalk status
/prewalk disarm
```

startup flags provide the same behavior for automated runs:

```sh
pi --prewalk \
  --prewalk-target opencode-go/qwen3.8-flash \
  --prewalk-thinking medium \
  "fix authentication timeout handling and add focused coverage"
```

the active model when the task starts is the planner. the configured target and thinking level apply only after handoff. a bare model id is accepted when it uniquely identifies an authenticated model; otherwise prewalk lists the canonical `provider/model` choices.

when the target is omitted, prewalk prefers `opencode/glm-5.2`. if it is unavailable, prewalk warns and chooses the cheapest authenticated non-current model deterministically.

## lifecycle

prewalk injects a hidden planning instruction with the task. with todo active, only a successful todo result opens the gate. without todo, the gate starts open.

the first successful edit or write after that gate requests the model transition. shell commands and failed edits or writes do not transition. a text-only planning turn receives one continuation prompt, and successful tool progress can re-arm that one-turn safety net. each arm operation can request at most one transition.

## development

```sh
npm install
npm run check
```

## lineage

this project is inspired by [the harness is the thing](https://scott-fryxell.github.io/blog/the-harness-is-the-thing/) by [scott fryxell](https://github.com/scott-fryxell) and by stencil's [prewalk](https://stencil.so/blog/prewalk) post. scott's own implementation lives at [brayness/extensions/prewalk](https://github.com/scott-fryxell/brayness/tree/main/extensions/prewalk).

i wrote my own instead of using scott's because i wanted the trajectory router separated from the policy, so the same model-transition machinery can back other tests and features later. it was also my way into learning pi extensions and how they work.
