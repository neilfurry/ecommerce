import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@marketplace/ui';
import { LayoutGridIcon } from 'lucide-react';
import { Link } from 'react-router';
import { useCategoryTree } from '../../hooks/use-category-tree';

export function CategoryMenu() {
  const { roots, childrenOf } = useCategoryTree();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <LayoutGridIcon aria-hidden="true" /> Categories
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] w-64 overflow-auto">
        {roots.map((root, index) => (
          <div key={root.id}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="p-0">
              <DropdownMenuItem asChild>
                <Link to={`/c/${root.slug}`} className="font-medium">
                  {root.name}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuLabel>
            {childrenOf(root.id).map((child) => (
              <DropdownMenuItem key={child.id} asChild>
                <Link to={`/c/${child.slug}`} className="pl-5 text-muted-foreground">
                  {child.name}
                </Link>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
