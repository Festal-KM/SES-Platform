// 対照: `method` も `action` も持たない `<form>`（行番号をテストが固定する）。
type Props = { readonly onSubmit: () => void };

export function Violation({ onSubmit }: Props) {
  return (
    <section>
      <form onSubmit={onSubmit} data-testid="single-line" />
      <form
        onSubmit={onSubmit}
        className="flex"
        data-testid="multi-line"
      />
      <form onSubmit={() => { onSubmit(); }} data-testid="inline-handler" />
    </section>
  );
}
