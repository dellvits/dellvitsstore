'use client';
import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, GripVertical } from 'lucide-react';

export type ArrangeItem = { id: string; title: string; hint?: ReactNode; image?: string; off?: boolean };

/**
 * A list the administrator puts in order by dragging rows, or with the arrow buttons (which also
 * work on phones and with the keyboard). `onChange` receives the ids in their new order.
 */
export function ArrangeList({ items, onChange }: { items: ArrangeItem[]; onChange: (ids: string[]) => void }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const ids = items.map((i) => i.id);
  const move = (id: string, to: number) => {
    const rest = ids.filter((x) => x !== id);
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, id);
    onChange(rest);
  };
  return (
    <ol className="arrange-list">
      {items.map((item, i) => (
        <li
          key={item.id}
          className={'arrange-row' + (dragging === item.id ? ' dragging' : '') + (item.off ? ' off' : '')}
          draggable
          onDragStart={(e) => {
            setDragging(item.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => setDragging(null)}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragging && dragging !== item.id) move(dragging, i);
          }}
        >
          <GripVertical size={16} className="arrange-grip" aria-hidden />
          <span className="arrange-no">{i + 1}</span>
          {item.image !== undefined &&
            (item.image ? <img className="cell-thumb" src={item.image} alt="" /> : <span className="cell-thumb placeholder" />)}
          <span className="cell-stack">
            <strong>{item.title}</strong>
            {item.hint && <small>{item.hint}</small>}
          </span>
          <span className="arrange-actions">
            <button type="button" className="icon-action" disabled={!i} onClick={() => move(item.id, 0)} aria-label={`Move ${item.title} to the top`} title="Move to the top">
              <ChevronsUp size={15} />
            </button>
            <button type="button" className="icon-action" disabled={!i} onClick={() => move(item.id, i - 1)} aria-label={`Move ${item.title} up`} title="Move up">
              <ArrowUp size={15} />
            </button>
            <button
              type="button"
              className="icon-action"
              disabled={i === items.length - 1}
              onClick={() => move(item.id, i + 1)}
              aria-label={`Move ${item.title} down`}
              title="Move down"
            >
              <ArrowDown size={15} />
            </button>
            <button
              type="button"
              className="icon-action"
              disabled={i === items.length - 1}
              onClick={() => move(item.id, items.length)}
              aria-label={`Move ${item.title} to the bottom`}
              title="Move to the bottom"
            >
              <ChevronsDown size={15} />
            </button>
          </span>
        </li>
      ))}
    </ol>
  );
}
