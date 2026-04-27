interface StatusTagProps {
  children: React.ReactNode;
  variant?: 'default' | 'green';
}

export function StatusTag({ children, variant = 'default' }: StatusTagProps) {
  return (
    <span
      className={`inline-block text-[10px] font-bold tracking-widest uppercase px-2 py-1 rounded-xs text-white whitespace-nowrap ${
        variant === 'green' ? 'bg-green-500' : 'bg-white/15'
      }`}
    >
      {children}
    </span>
  );
}
