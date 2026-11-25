---
name: meetless
description: Use when a task arrives with a meetless:// link or a Meetless handoff, or when the project you are working on tracks its needs and hypotheses in Meetless. Reads live need context, reports work, proposes new needs and sets hypothesis verdicts over the Meetless MCP tools.
---

# Meetless

Meetless tracks a project's needs, hypotheses, handoffs and artifacts. When a task comes with a
`meetless://` link, or the project you are working on uses Meetless, read this before you start.

## Before starting

Call `get_need_context` with the link (or the project id and need code). Read the acceptance
criteria and the refuted hypotheses before you plan any work, and note the version you were
given: the context can change while you work.

## At each milestone

Call `record_work` with what you changed, why, and the effect it had. This counts as progress on
the need and is what the person waiting on it will see, so keep it factual: say what actually
happened, not what you intend to do next.

## New needs or ideas

If you spot a need that nobody asked for, call `propose_need`. It is not created directly: the
proposal lands in 「待确认」 (To confirm) for a person to accept or reject.

## Hypotheses

When you have evidence for or against a hypothesis, call `set_verdict` with the status and what
the evidence shows.

## When the context is stale

If `get_need_context` says the context is outdated, or the person asks you to refresh, call it
again before you keep going. Do not keep working from a version you already know is old.

## When you are done

Call `record_work` once more with a summary of the whole piece of work, then tell the person to
press 「交回」 (Return) in Meetless. You cannot return or close a handoff yourself; only the
person it was handed to can do that.

## Other tools

- `list_needs` lists the needs of a project you can see, with their code, title, kind, status and
  round.
- `search` looks across needs, inputs, artifacts and work in your projects, or in one project.
- `read_artifact` reads an artifact's latest version, or a version you name, and the need codes it
  is linked to.

## Rules

Never copy anything this context gives you outside the project it came from: not into another
tool, another chat, or a file outside the repository you were handed it in.

Never describe rule-based output, or your own report, as a review. Meetless does not run any kind
of AI review, and nothing here should be presented as one.

This skill works the same way in Claude Code and in Codex. No other agent tool is named here.
