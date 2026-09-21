// The list that drops up when a message starts with `/`, grouped the way Claude Code's is:
// a heading per group, one highlighted row, arrows and Enter to choose.
import { useEffect, useRef } from 'react';
import { GROUP_ORDER, type Command, type CommandContext } from './commands';

type Props = {
  matches: Command[];
  /** Values for a command that takes an argument, once its name is typed. */
  options: string[];
  active: number;
  context: CommandContext;
  onActive: (index: number) => void;
  onChoose: (index: number) => void;
};

export function CommandPanel({ matches, options, active, context, onActive, onChoose }: Props) {
  const list = useRef<HTMLDivElement>(null);

  // Keep the highlighted row in view when the arrows walk past the edge of the list.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('.cmd-row.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (options.length > 0) {
    const command = matches[0];
    return (
      <div className="cmd-panel" role="listbox" aria-label={`Values for ${command?.name ?? 'command'}`} ref={list}>
        <div className="cmd-group">{command?.name}{command?.args ? ` ${command.args}` : ''}</div>
        {options.map((option, index) => (
          <button
            key={option}
            type="button"
            role="option"
            aria-selected={index === active}
            className={`cmd-row${index === active ? ' active' : ''}`}
            onMouseEnter={() => onActive(index)}
            onPointerDown={(event) => {
              event.preventDefault();
              onChoose(index);
            }}
          >
            <span className="cmd-name">{option}</span>
          </button>
        ))}
      </div>
    );
  }

  if (matches.length === 0) return null;

  let row = -1;
  return (
    <div className="cmd-panel" role="listbox" aria-label="Slash commands" ref={list}>
      {GROUP_ORDER.map((group) => {
        const inGroup = matches.filter((command) => command.group === group);
        if (inGroup.length === 0) return null;
        return (
          <div key={group} className="cmd-section">
            <div className="cmd-group">{group}</div>
            {inGroup.map((command) => {
              row += 1;
              const index = row;
              const why = command.disabled?.(context) ?? null;
              return (
                <button
                  key={command.name}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={`cmd-row${index === active ? ' active' : ''}${why ? ' disabled' : ''}`}
                  title={why ?? command.summary}
                  onMouseEnter={() => onActive(index)}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    if (!why) onChoose(index);
                  }}
                >
                  <span className="cmd-name">
                    {command.name}
                    {command.args && <span className="cmd-args"> {command.args}</span>}
                  </span>
                  <span className="cmd-summary">{why ?? command.summary}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** The commands in the order the panel draws them, so the arrow keys and the rows agree. */
export function panelOrder(matches: Command[]): Command[] {
  return GROUP_ORDER.flatMap((group) => matches.filter((command) => command.group === group));
}
