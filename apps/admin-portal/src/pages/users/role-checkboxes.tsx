import { ROLE_LABELS, type UserRole } from '@marketplace/shared-types';
import { Checkbox, Label } from '@marketplace/ui';

/** Checkbox list of roles; roles the current admin may not grant are shown but disabled. */
export function RoleCheckboxes({
  value,
  onChange,
  options,
  grantable,
  invalid,
}: {
  value: readonly UserRole[];
  onChange: (roles: UserRole[]) => void;
  options: readonly UserRole[];
  grantable: readonly UserRole[];
  invalid?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="group" aria-invalid={invalid || undefined}>
      {options.map((role) => {
        const id = `role-${role}`;
        const checked = value.includes(role);
        return (
          <div key={role} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={checked}
              disabled={!grantable.includes(role)}
              onCheckedChange={(next) =>
                onChange(next === true ? [...value, role] : value.filter((r) => r !== role))
              }
            />
            <Label htmlFor={id} className="font-normal">
              {ROLE_LABELS[role]}
            </Label>
          </div>
        );
      })}
    </div>
  );
}
