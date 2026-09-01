interface AlertProps {
  type: "success" | "error" | "warning" | "info";
  message: string;
}

const styles = {
  success: "bg-green-50 border-green-400 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  error:   "bg-red-50 border-red-400 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  warning: "bg-yellow-50 border-yellow-400 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  info:    "bg-blue-50 border-blue-400 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

const icons = {
  success: "✓",
  error:   "✕",
  warning: "⚠",
  info:    "ℹ",
};

export function Alert({ type, message }: AlertProps) {
  return (
    <div className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${styles[type]}`}>
      <span className="font-bold mt-0.5">{icons[type]}</span>
      <span>{message}</span>
    </div>
  );
}
