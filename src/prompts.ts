export const PLAN_PROMPT = `Establish the implementation trajectory before the target model takes over: the decisions you record now are the ones it will execute.

Record a bounded TODO list of 5-9 meaningful items. An item is complete only when it names both the change and the check that proves the change landed. Build the list from the repository and task evidence already in context.

Then continue straight into implementation: this turn ends with the first concrete edit or write landed, not with the list.`;

export const CONTINUE_PROMPT = "The plan is recorded. Implement now: land the next concrete edit or write this turn.";

export const CHECKLIST_PROMPT = `The task is complete only when every check below passes:

- Consistency: every call site and duplicate pattern affected by the change is found by search and updated.
- Scope: behavior outside the task is unchanged.
- Verification: the relevant focused checks and the full test suite run clean.`;
