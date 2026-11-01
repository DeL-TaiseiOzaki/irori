# 053 — One subject per screen, one meaning per colour

Date: 2026-11-01. Status: owner request; implemented for 0.2.52.
Revises the visual system of [ADR 014](014-ui-v5.md) (decisions 7 and 8);
the levels, the vault as the unit, the agents and every function stay as they are.

## Context

The owner asked for an interface that looks less machine-made: not an
evenly tidy average, but one where each screen has a clear subject, the eye
moves from looking to comparing to acting, colours have roles, real data
(long names, missing values, zero, very large counts, duplicates) does not
break it, and anything that is not needed is gone. The download site's
headline, "From your notes, to what's next.", read the same way; the owner
asked for **irori - IDE for Second Brain** in both languages.

Before this change the window was three floating islands of equal weight on a
graphite backdrop, each with a 14 px radius and a shadow. Ember meant the AI,
the brand, the keyboard focus, the current tab, running, waiting for the
person, sending and allowing, and decorated callouts and the map. Contents'
teal also marked uploads and finished steps; diff green marked "saved" and
"succeeded". The AI was announced with sparkles, glows, halos, a shimmer,
floating map nodes, a dotted canvas and two canned requests in every empty
conversation.

## Decisions

1. **The page is the subject.** The paper stage is the only lit surface. The
   vault panel, the agent columns, the rail and the status bar are one flat
   chrome surface, joined by hairlines that are also the resize handles. No
   island radius, gap or shadow.
2. **Colour roles**, each with one meaning (`src/app/tokens.css`):

   | Role      | Tokens                         | Means                                                                   |
   | --------- | ------------------------------ | ----------------------------------------------------------------------- |
   | Brand     | `--brand`                      | irori's ember: the mark and the website's mark only                     |
   | Action    | `--solid`, `--ink-solid`       | the one primary button of a place; no hue                               |
   | Focus     | `--focus`, `--act*`            | keyboard focus, the column being edited, a chosen option, a drop target |
   | Running   | `--run*`                       | something works on its own; neutral, told by motion                     |
   | Attention | `--attn*` (`--warn-*` aliases) | waits for the person: approval, conflict, warning                       |
   | Danger    | `--danger*`                    | failed, or cannot be undone                                             |
   | Identity  | `--schema`, `--cont`, `--t-*`  | which layer or which vault; never a state                               |
   | Diff      | `--add-*`, `--del-*`           | added and removed, inside a diff or change list only                    |

   A normal outcome — saved, mounted, succeeded, done — takes no colour.
   Syntax in the source view is weight and grey, not hue.

3. **The agent is a tool, not a decoration.** Its mark is a conversation icon
   (`agent`), skills have their own (`skill`). The stage bar's agent button,
   the send button and the irori agent's mark are neutral or solid. An empty
   conversation offers no canned requests: the composer is the one place to
   write one. Glows, halos (except the one waiting dot), shimmer, floating map
   nodes, flowing reference lines and the dotted map are gone. A hand-off is a
   solid line and a reference a dashed one.
4. **One primary action per screen.** The vault home commits while there are
   changes, else opens today's note where daily notes are on, else creates a
   note. The start screen opens the first workspace; creating another is
   framed once one exists, and a first launch makes adding a vault the first
   step. The home is two columns without boxes: changes (only when there are
   some) and the notes, then the records, the Schema and the contents, quieter.
5. **Real data.** Counts in badges stop at `99+` (`countLabel`); a broken time
   shows as `—`; tabs of two files with one name show as much of their folder
   as tells them apart (`src/domain/tab-labels.ts`); long paths keep their end;
   long vault names give way to an ellipsis with the full name as the title; a
   workspace that lost a vault says so in the attention colour; ahead and
   behind show only when not zero.
6. **Name.** The start screen, the website title and the READMEs say
   **irori - IDE for Second Brain**, in English in both languages.

## Consequences

- `layers-ui-smoke` checks that an empty conversation offers no canned
  requests instead of filling one; `website-smoke` checks the new title.
- The website shares the roles: solid paper for its action, no glow or ember
  text; its screenshots were retaken.
- The motion of ADR 014 decision 8 is reduced to state: the running arc and
  bar, the waiting dot, and the zoom between levels.
