"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import styles from "./expandable-text.module.css";

type Props = {
  text: string;
  className?: string;
  lines?: number;
  as?: "p" | "h1" | "h2" | "h3";
};

export default function ExpandableText({ text, className = "", lines = 3, as = "p" }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  const Tag = as;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const measure = () => {
      if (expanded) return;
      setOverflowing(node.scrollHeight > node.clientHeight + 2 || node.scrollWidth > node.clientWidth + 2);
    };

    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [expanded, text, lines]);

  const style = { "--expand-lines": lines } as CSSProperties;

  return (
    <div className={styles.wrap}>
      <Tag
        ref={(node) => { ref.current = node; }}
        className={`${className} ${expanded ? styles.expanded : styles.clamped}`}
        style={style}
      >
        {text}
      </Tag>
      {(overflowing || expanded) ? (
        <button className={styles.toggle} type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "ย่อ" : "ดูเพิ่ม"}
        </button>
      ) : null}
    </div>
  );
}
