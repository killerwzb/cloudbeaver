/*
 * cloudbeaver - Cloud Database Manager
 * Copyright (C) 2020 DBeaver Corp and others
 *
 * Licensed under the Apache License, Version 2.0.
 * you may not use this file except in compliance with the License.
 */

import { observable } from 'mobx';

import { injectable } from '@cloudbeaver/core-di';
import { GQLError, ServerInternalError } from '@cloudbeaver/core-sdk';
import { OrderedMap } from '@cloudbeaver/core-utils';

import { EventsSettingsService } from './EventsSettingsService';
import {
  ENotificationType,
  INotification,
  INotificationExtraProps,
  INotificationOptions,
  NotificationComponent,
  INotificationProcessExtraProps,
  IProcessNotificationContainer
} from './INotification';
import { ProcessNotificationController } from './ProcessNotificationController';

export const DELAY_DELETING = 1000;
@injectable()
export class NotificationService {
  // todo change to common new Map()

  readonly notificationList = new OrderedMap<number, INotification<any>>(({ id }) => id);
  private notificationNextId = 0;

  get visibleNotifications(): Array<INotification<any>> {
    return this.notificationList.values.filter(notification => !notification.isSilent);
  }

  constructor(
    private settings: EventsSettingsService
  ) {}

  notify<TProps extends INotificationExtraProps<any> = INotificationExtraProps>(
    options: INotificationOptions<TProps>, type: ENotificationType
  ): INotification<TProps> {
    if (options.persistent) {
      const persistentNotifications = this.notificationList.values.filter(value => value.persistent);
      if (persistentNotifications.length >= this.settings.settings.getValue('maxPersistentAllow')) {
        throw new Error(`You cannot create more than ${this.settings.settings.getValue('maxPersistentAllow')} persistent notification`);
      }
    }

    const id = this.notificationNextId++;

    const notification: INotification<TProps> = {
      id,
      title: options.title,
      message: options.message,
      details: options.details,
      isSilent: !!options.isSilent,
      customComponent: options.customComponent,
      extraProps: options.extraProps || {} as TProps,
      persistent: options.persistent,
      state: observable({ deleteDelay: 0 }),
      timestamp: options.timestamp || Date.now(),
      type,
      close: delayDeleting => this.close(id, delayDeleting),
      showDetails: this.showDetails.bind(this, id),
    };

    this.notificationList.addValue(notification);

    const filteredNotificationList = this.notificationList.values.filter(notification => !notification.persistent);

    if (filteredNotificationList.length > this.settings.settings.getValue('notificationsPool')) {
      let i = 0;
      while (this.notificationList.get(this.notificationList.keys[i])?.persistent) {
        i++;
      }
      this.notificationList.remove(this.notificationList.keys[i]);
    }

    return notification;
  }

  customNotification<
    TProps extends INotificationExtraProps<any> = INotificationExtraProps
  >(
    component: () => NotificationComponent<TProps>,
    props?: TProps extends any ? TProps : never, // some magic
    options?: INotificationOptions<TProps> & { type?: ENotificationType }
  ): void {
    this.notify({
      title: '',
      ...options,
      customComponent: component,
      extraProps: props || {} as TProps,
    }, options?.type ?? ENotificationType.Custom);
  }

  processNotification<
    TProps extends INotificationProcessExtraProps<any> = INotificationExtraProps>(
    component: () => NotificationComponent<TProps>,
    props?: TProps extends any ? TProps : never, // some magic,
    options?: INotificationOptions<TProps>
  ): IProcessNotificationContainer<TProps> {
    const processController = props?.state || new ProcessNotificationController();

    const notification = this.notify({
      title: '',
      ...options,
      extraProps: { ...props, state: processController } as TProps,
      customComponent: component,
    }, ENotificationType.Custom);

    processController.init(notification.title, notification.message);
    return { controller: processController, notification };
  }

  logInfo<T>(notification: INotificationOptions<T>): void {
    this.notify(notification, ENotificationType.Info);
  }

  logSuccess<T>(notification: INotificationOptions<T>): void {
    this.notify(notification, ENotificationType.Success);
  }

  logError<T>(notification: INotificationOptions<T>): void {
    this.notify(notification, ENotificationType.Error);
  }

  logException(exception: Error | GQLError, title?: string, message?: string, silent?: boolean): void {
    const errorDetails = getErrorDetails(exception);

    if (!silent) {
      this.logError({
        title: title || errorDetails.name,
        message: message || errorDetails.message,
        details: hasDetails(exception) ? exception : undefined,
        isSilent: silent,
      });
    }

    console.error(exception);
  }

  close(id: number, delayDeleting = true): void {
    // TODO: emit event or something

    if (delayDeleting) {
      const notification = this.notificationList.get(id);

      if (notification) {
        notification.state.deleteDelay = DELAY_DELETING;
        setTimeout(() => {
          this.notificationList.remove(id);
        }, DELAY_DELETING);
      }
      return;
    }
    this.notificationList.remove(id);
  }

  showDetails(id: number): void {
    // TODO: emit event or something
  }
}

export function hasDetails(error: Error): error is GQLError | ServerInternalError {
  return error instanceof GQLError || error instanceof ServerInternalError;
}

export function getErrorDetails(error: Error | GQLError) {
  const exceptionMessage = hasDetails(error) ? error.errorText : error.message || error.name;
  return { name: error.name, message: exceptionMessage };
}
