export function formValue(event: Event): string {
  return (event.currentTarget as EventTarget & { value: string }).value;
}

export function checkedValue(event: Event): boolean {
  return (event.currentTarget as EventTarget & { checked: boolean }).checked;
}