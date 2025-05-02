export const Button = ({
  onClick,
  children,
  className,
  variant = "primary",
}: {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  variant?: "primary" | "secondary" | "outline";
}) => {
  const baseStyles = "px-4 py-2 rounded-lg text-lg font-medium transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-opacity-50";
  
  const variantStyles = {
    primary: "bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white shadow-md hover:shadow-lg focus:ring-green-400",
    secondary: "bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white shadow-md hover:shadow-lg focus:ring-purple-400",
    outline: "bg-transparent border-2 border-green-500 text-green-500 hover:bg-green-500 hover:text-white focus:ring-green-400"
  };

  return (
    <button
      onClick={onClick}
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
    >
      {children}
    </button>
  );
};
