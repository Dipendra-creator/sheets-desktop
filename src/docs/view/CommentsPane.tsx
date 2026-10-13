// Comments pane (Review > Show Comments): every comment in document order.

import { TextSelection } from "prosemirror-state";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { friendlyDate } from "../../lib/formats";
import type { DocController } from "../editor/controller";
import { useDoc } from "./hooks";

function CommentCard({ ctl, id, quote, from, to }: { ctl: DocController; id: string; quote: string; from: number; to: number }) {
  const data = ctl.commentData(id);
  const editing = useDoc(ctl, (c) => c.editingComment === id);
  const [text, setText] = useState(data.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) {
      setText(data.text);
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [editing]);
  const date = data.date ? Date.parse(data.date) : NaN;
  const initials =
    data.initials ||
    (data.author || "?")
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  return (
    <div
      className={`comment-card ${editing ? "editing" : ""}`}
      onClick={() => {
        if (!editing) {
          ctl.goTo(from);
          if (to > from && ctl.view) ctl.view.dispatch(ctl.view.state.tr.setSelection(TextSelection.create(ctl.view.state.doc, from, to)));
        }
      }}
    >
      <div className="cc-head">
        <span className="cc-avatar">{initials}</span>
        <div className="cc-who">
          <b>{data.author || "Unknown"}</b>
          {Number.isFinite(date) && <span className="muted small">{friendlyDate(date)}</span>}
        </div>
        <button
          className="tb-icon"
          title="Delete comment"
          onClick={(e) => {
            e.stopPropagation();
            ctl.deleteComment(id);
          }}
        >
          <Icon name="x" size={12} />
        </button>
      </div>
      {quote && <div className="cc-quote">{quote}</div>}
      {editing ? (
        <div className="cc-edit">
          <textarea
            ref={ref}
            value={text}
            rows={3}
            placeholder="Add a comment"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) ctl.updateComment(id, text);
              if (e.key === "Escape") {
                ctl.editingComment = null;
                ctl.emit();
              }
            }}
          />
          <div className="cc-actions">
            <button className="btn primary" disabled={!text.trim()} onClick={() => ctl.updateComment(id, text)}>
              Post
            </button>
            <button
              className="btn"
              onClick={() => {
                if (!data.text) ctl.deleteComment(id);
                ctl.editingComment = null;
                ctl.emit();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          className="cc-text"
          onDoubleClick={(e) => {
            e.stopPropagation();
            ctl.editingComment = id;
            ctl.emit();
          }}
          title="Double-click to edit"
        >
          {data.text || <span className="muted">(empty)</span>}
        </div>
      )}
    </div>
  );
}

export function CommentsPane({ ctl }: { ctl: DocController }) {
  const doc = useDoc(ctl, (c) => c.state.doc);
  useDoc(ctl, (c) => c.commentEdits);
  const list = ctl.commentList();
  void doc;
  return (
    <aside className="comments-pane">
      <div className="nav-head">
        <span>Comments</span>
        <button className="tb-icon" title="New Comment" onClick={() => ctl.newComment()}>
          <Icon name="plus" size={12} />
        </button>
        <button className="tb-icon" title="Close" onClick={() => ctl.toggleComments()}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="comments-body">
        {list.length ? (
          list.map((c) => <CommentCard key={c.id} ctl={ctl} id={c.id} quote={c.quote} from={Math.min(c.from, c.to)} to={Math.max(c.from, c.to)} />)
        ) : (
          <p className="nav-empty">No comments yet. Select some text and choose New Comment to start a conversation.</p>
        )}
      </div>
    </aside>
  );
}
