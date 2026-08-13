# Planning Documents

This directory contains the authoritative specifications for the Amazon DSP Driver Allocation System. Every implementation task must reference these documents.

## Documents

| File | Description |
|------|-------------|
| `PLAN.md` | Implementation plan with phases, task breakdown, timeline, and success criteria. |
| `requirements.md` | Functional (RF) and non-functional (RNF) requirements, business rules (RN), and stakeholder roles. |
| `data-model.md` | Complete Prisma schema, entity dictionary, ER diagram, indexes, and data flow diagrams. |
| `ux-flows.md` | Screen-by-screen UX specification with wireframes, field lists, component suggestions, and Tailwind classes. |
| `distribution-algorithm.md` | Allocation algorithm specification: inputs, outputs, pseudocode, scoring formula, and edge cases. |
| `adr.md` | Architecture Decision Record: technology choices, deployment strategy, security, and compliance. |

## Usage

- **Before implementing any feature**, read the relevant sections of these documents.
- **When the spec is ambiguous**, refer to `data-model.md` for the database schema as the source of truth.
- **When the spec contradicts the schema**, flag the conflict and implement the option consistent with the database.
- **These documents are living artifacts.** Update them when requirements change or decisions are revised.
