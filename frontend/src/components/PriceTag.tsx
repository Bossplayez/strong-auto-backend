interface PriceTagProps {
  value: number;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'green' | 'dark';
}

function formatPrice(n: number): string {
  return n.toLocaleString('en-US').replace(/,/g, ' ');
}

export function PriceTag({ value, size = 'md', variant = 'green' }: PriceTagProps) {
  const sizeClasses = {
    sm: 'text-sm px-2 py-0.5',
    md: 'text-base px-2 py-0.5',
    lg: 'text-2xl px-3 py-1',
  };

  const colorClasses = variant === 'green'
    ? 'text-green-500 border-green-500'
    : 'text-navy-800 border-navy-800';

  return (
    <span
      className={`inline-flex items-center bg-white border-2 font-bold font-sans rounded-xs whitespace-nowrap ${sizeClasses[size]} ${colorClasses}`}
    >
      ${formatPrice(value)}
    </span>
  );
}
