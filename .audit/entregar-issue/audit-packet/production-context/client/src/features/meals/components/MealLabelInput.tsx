import React from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Clock3 } from "lucide-react";

type MealScheduleOption = {
  mealLabel: string;
  enabled: boolean;
};

type MealLabelInputProps = {
  value: string;
  onChange: (value: string) => void;
  suggestedLabel?: string | null;
};

function normalizeLabel(value: string) {
  return value.trim().toLocaleLowerCase("pt-BR");
}

export function MealLabelInput({ value, onChange, suggestedLabel }: MealLabelInputProps) {
  const schedulesQuery = trpc.nutrition.mealSchedules.list.useQuery();
  const previousSuggestedLabelRef = React.useRef<string | null | undefined>(suggestedLabel);
  const [open, setOpen] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState("");

  const configuredMealLabels = React.useMemo(() => {
    const schedules = (schedulesQuery.data as MealScheduleOption[] | undefined) ?? [];
    const uniqueLabels = new Map<string, string>();

    for (const schedule of schedules) {
      const trimmedMealLabel = schedule.mealLabel.trim();
      if (!schedule.enabled || !trimmedMealLabel) {
        continue;
      }

      const normalizedMealLabel = normalizeLabel(trimmedMealLabel);
      if (!uniqueLabels.has(normalizedMealLabel)) {
        uniqueLabels.set(normalizedMealLabel, trimmedMealLabel);
      }
    }

    return Array.from(uniqueLabels.values());
  }, [schedulesQuery.data]);

  React.useEffect(() => {
    const previousSuggestedLabel = previousSuggestedLabelRef.current;
    previousSuggestedLabelRef.current = suggestedLabel;

    if (!suggestedLabel || suggestedLabel === value) {
      return;
    }

    const normalizedValue = normalizeLabel(value);
    const isFollowingAutomaticLabel = !value.trim()
      || (previousSuggestedLabel
        ? normalizedValue === normalizeLabel(previousSuggestedLabel)
        : false);

    if (isFollowingAutomaticLabel) {
      onChange(suggestedLabel);
    }
  }, [onChange, suggestedLabel, value]);

  const trimmedSearchValue = searchValue.trim();
  const buttonLabel = value.trim() || "Selecione a refeição";

  return (
    <div className="space-y-2">
      <Label>Nome da refeição</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between rounded-2xl font-normal"
          >
            <span className="truncate">{buttonLabel}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Buscar refeição..."
              value={searchValue}
              onValueChange={setSearchValue}
            />
            <CommandList>
              <CommandEmpty>{configuredMealLabels.length ? "Nenhuma refeição encontrada" : "Nenhuma refeição cadastrada nas configurações"}</CommandEmpty>
              <CommandGroup>
                {configuredMealLabels.map(label => {
                  const isSelected = normalizeLabel(value) === normalizeLabel(label);
                  return (
                    <CommandItem
                      key={label}
                      value={label}
                      onSelect={() => {
                        onChange(label);
                        setOpen(false);
                        setSearchValue("");
                      }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                      {label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {suggestedLabel ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock3 className="h-3 w-3" />
          Sugestão pelo horário: {suggestedLabel}
        </p>
      ) : null}
    </div>
  );
}
