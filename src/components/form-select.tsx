"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function FormSelect({
  name,
  options,
  defaultValue,
  placeholder,
  className,
}: {
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Select name={name} defaultValue={defaultValue}>
      <SelectTrigger className={className ?? "w-full"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
