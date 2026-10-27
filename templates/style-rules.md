# Style rules

Nine rules for how a document gets written in this project.

**This is not a template.** It lives in `ae-kit-templates/` because that is what the installer copies, but nothing here is meant to be filled in or adapted per project. It is kit content: the same nine rules everywhere. A project that does not want them declares the file in `.ae-kit-excluded`, with a reason.

## Three levels

What sets the bar is how often a file gets read.

| Level | Files | Paragraph ceiling |
|---|---|---|
| 1 | `STATUS.md`, `CLAUDE.md`, `TASKS.md`, `BACKLOG.md`, and replies in chat | 60 words |
| 2 | `tasks/`, `docs/`, `PENDINGS.md` | 90 words |
| 3 | `logs/sessions/` | none |

All nine rules apply at every level. Only the paragraph ceiling changes.

## The rules

| | Rule | How to check it by eye |
|---|---|---|
| E1 | A sentence doesn't close by denying what it never claimed | The sentence ends where the claim ends |
| E2 | Bold marks the first thing to see, so there is little of it | If the eye jumps to three places in one prose paragraph, two are surplus |
| E3 | A finding is described, not rated | Cover the alarm marker. If the text no longer says how bad it is, the marker was doing the sentence's job |
| E4 | Paragraph ceiling, by level | More than six lines on screen already passed the Level 1 ceiling |
| E5 | Sentence ceiling: 30 words | If you have to re-read to find the subject, there is surplus sentence |
| E6 | A heading names its content, not its importance | A heading you can't understand without reading on is wrong |
| E7 | Quote the project owner when the exact words are the content | If the previous sentence already said it, the quote is surplus |
| E8 | A term coined here gets defined on first use, or isn't used | Would someone installing the kit today understand it? |
| E9 | A name states what happens, not what it means | If the name carries an interpretation the reader can't yet verify, it is surplus |

**E3, concretely.** Not allowed: alarm emoji (⚠️ ⚑ 🔴 🚨), shouted capitals, superlatives (*the worst*, *the most serious*), violent verbs (*blows up*, *takes down*), and *"what really matters"*. Severity is shown by the number and by what closes it.

**E2, concretely.** The threshold limits **emphatic** bold — the kind inside running prose. **Structural** bold — the head of an entry in a long list, a field label — does not count. It is what lets a reader scan twenty-five decisions without reading all of them.

## Exceptions

| Rule | When it doesn't apply |
|---|---|
| E1 | When the discarded alternative is the one the reader already had in mind: *"fixed forward, not with `force-push`"* |
| E3 | A severity judgement is fine when it comes with its scope and with what closes it |
| E7 | When a paraphrase would change the decision |
| E8 | A term that names something real with no other short name stays, with its definition |

## Thresholds

For whenever a checker exists. There is none today.

| Rule | Threshold |
|---|---|
| E1 | ≤1 per 1000 words |
| E2 | ≤8 per 1000 words, emphatic bold only |
| E3 | zero alarm emoji and shouted capitals |
| E4 | 60 / 90 / none |
| E5 | 30 words |

E6, E7, E8 and E9 are not countable. They need judgement, and they are declared that way rather than faking a threshold.

## Why each rule exists

`ae-kit-templates/style-rules-appendix.md` — the measured pattern behind each rule, its examples, and the rewrite alongside each one. Open it when arguing about a rule.

## What no rule here covers

None of this checks that a document is **true**. Every rule above is about form.
