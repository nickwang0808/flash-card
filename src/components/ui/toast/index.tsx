import { createToastHook } from '@gluestack-ui/core/toast/creator';
import { forwardRef, type ComponentProps, type ElementRef } from 'react';
import { Text, View } from 'react-native';

const useToast = createToastHook(View);

type ToastProps = ComponentProps<typeof View> & { action?: 'error' | 'warning' | 'success' | 'info' | 'muted'; variant?: 'solid' | 'outline' };

const Toast = forwardRef<ElementRef<typeof View>, ToastProps>(function Toast({ className, ...props }, ref) {
  return <View ref={ref} className={`m-1 gap-1 rounded-md border border-border bg-popover p-4 ${className ?? ''}`} {...props} />;
});

const ToastTitle = forwardRef<ElementRef<typeof Text>, ComponentProps<typeof Text>>(function ToastTitle({ className, ...props }, ref) {
  return <Text ref={ref} accessibilityLiveRegion="assertive" role="alert" className={`font-medium text-popover-foreground ${className ?? ''}`} {...props} />;
});

const ToastDescription = forwardRef<ElementRef<typeof Text>, ComponentProps<typeof Text>>(function ToastDescription({ className, ...props }, ref) {
  return <Text ref={ref} className={`text-muted-foreground ${className ?? ''}`} {...props} />;
});

export { Toast, ToastDescription, ToastTitle, useToast };
