import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDaysToDateInputValue } from "../mealViewModels";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

type DayNavigatorProps = {
  selectedDay: string;
  onSelectedDayChange: (selectedDay: string) => void;
  label?: string;
};

export function DayNavigator({ selectedDay, onSelectedDayChange, label = "Dia" }: DayNavigatorProps) {
  const goToPreviousDay = () => onSelectedDayChange(addDaysToDateInputValue(selectedDay, -1));
  const goToNextDay = () => onSelectedDayChange(addDaysToDateInputValue(selectedDay, 1));

  return (
    <div className="grid grid-cols-[2.5rem_minmax(10.5rem,12rem)_2.5rem] items-center gap-x-2 gap-y-2">
      <div className="col-start-2 flex justify-center">
        <Label htmlFor="meal-selected-day" className="flex items-center justify-center gap-2 whitespace-nowrap text-center">
          <CalendarDays className="h-4 w-4 text-primary" />
          {label}
        </Label>
      </div>
      <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={goToPreviousDay} aria-label="Dia anterior">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Input
        id="meal-selected-day"
        type="date"
        value={selectedDay}
        onChange={event => onSelectedDayChange(event.target.value)}
        className="h-10 min-w-[10.5rem] sm:w-48"
      />
      <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={goToNextDay} aria-label="Próximo dia">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
