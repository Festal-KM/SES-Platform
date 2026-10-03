// 対照: `method` か `action` を持つ `<form>` だけを並べる（検出器が誤検知しないこと）。
// 🔴 コメントの中の `<form onSubmit={x}>` は数えない（走査はコメントを剥がしてから見る）。
/* ブロックコメントの中の <form onSubmit={x}> も数えない */
type Props = { readonly onSubmit: () => void; readonly href: string };

export function Clean({ onSubmit, href }: Props) {
  return (
    <section>
      <form method="post" onSubmit={onSubmit} data-testid="a" />
      <form action={href} data-testid="b" />
      <form
        method="get"
        action="/search"
        data-testid="c"
      />
      {/* JSX コメントの中の <form onSubmit={onSubmit}> も数えない */}
      <formation-like data-testid="d" />
    </section>
  );
}
