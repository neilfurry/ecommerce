import { zodResolver } from '@hookform/resolvers/zod';
import { useCreateStaffUser, useSession } from '@marketplace/api-client';
import { applyApiErrors, FormAlert, SubmitButton } from '@marketplace/auth-ui';
import { grantableRoles } from '@marketplace/shared-types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  toast,
} from '@marketplace/ui';
import { type CreateStaffUserRequest, createStaffUserSchema } from '@marketplace/validation';
import { UserPlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { RoleCheckboxes } from './role-checkboxes';

export function InviteStaffDialog() {
  const session = useSession();
  const create = useCreateStaffUser();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const grantable = grantableRoles(session.data?.user.roles ?? []);
  const form = useForm<CreateStaffUserRequest>({
    resolver: zodResolver(createStaffUserSchema),
    defaultValues: { firstName: '', lastName: '', email: '', roles: [] },
  });

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await create.mutateAsync(values);
      toast.success('Invitation sent', {
        description: `${user.email} will receive a link to set a password.`,
      });
      form.reset();
      setOpen(false);
    } catch (error) {
      setFormError(applyApiErrors(form, error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlusIcon /> Invite staff member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a staff member</DialogTitle>
          <DialogDescription>
            They receive an email with a link to set their own password. The link expires in 7 days.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <FormAlert message={formError} />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Work email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="roles"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Roles</FormLabel>
                  <RoleCheckboxes
                    value={field.value}
                    onChange={field.onChange}
                    options={grantable}
                    grantable={grantable}
                    invalid={!!fieldState.error}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <SubmitButton pending={create.isPending}>Send invitation</SubmitButton>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
