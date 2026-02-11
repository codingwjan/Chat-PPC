# Push Notifications Implementation Guide

## Overview

Chat-PPC implements a **browser-native desktop notification system** that alerts users when new messages arrive. This implementation uses the **Web Notifications API** rather than a full Service Worker-based Web Push solution.

## Architecture

### Technology Stack

- **Client-Side**: Web Notifications API (browser native)
- **Real-Time Communication**: Server-Sent Events (SSE)
- **No Service Worker**: This project does not use background push notifications
- **No Server-Side Push**: No web-push library, VAPID keys, or push service subscription

### How It Works

```
┌─────────────┐          SSE Stream          ┌─────────────┐
│   Server    │ ─────────────────────────▶   │   Client    │
│             │   (New Messages)              │   Browser   │
└─────────────┘                               └─────────────┘
                                                     │
                                                     │ If permission granted
                                                     │ & not own message
                                                     ▼
                                              ┌─────────────┐
                                              │ Browser     │
                                              │ Notification│
                                              └─────────────┘
```

## Implementation Details

### 1. Client-Side Components

#### Main File
**Location**: `/client/src/components/chat-app.tsx`

#### Permission Management

The application tracks notification permission states:

```typescript
type NotificationState = "granted" | "denied" | "unsupported" | "default";
```

**State Initialization** (lines 374-379):
```typescript
const [notificationState, setNotificationState] = useState<NotificationState>(() => {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
});
```

**Request Permission** (lines 830-837):
```typescript
const requestNotificationPermission = useCallback(async (): Promise<void> => {
  if (typeof window === "undefined" || !("Notification" in window)) {
    setNotificationState("unsupported");
    return;
  }
  const permission = await Notification.requestPermission();
  setNotificationState(permission);
}, []);
```

#### Notification Display Logic

**Function**: `notifyMessages` (lines 556-574)

This function handles the actual notification display:

```typescript
const notifyMessages = useCallback(
  (incoming: MessageDTO[]) => {
    // Only proceed if permission granted and not leaving
    if (Notification.permission !== "granted" || isLeavingRef.current) return;
    
    for (const payload of incoming) {
      // Filter logic: Don't notify for own messages
      const isOwnByClientId = Boolean(session?.clientId) && 
                              payload.authorId === session?.clientId;
      const isOwnByUsername = currentUsername.length > 0 && 
                              payload.username === currentUsername;
      
      if (isOwnByClientId || isOwnByUsername) continue;
      
      // Truncate long messages
      const compactMessage = payload.message.length > 100 
        ? payload.message.slice(0, 100) + "..." 
        : payload.message;
      
      // Display notification
      new Notification(`${payload.username}: ${compactMessage}`, {
        icon: payload.profilePicture,
      });
    }
  },
  [session?.clientId, session?.username]
);
```

### 2. Real-Time Message Streaming

#### Server-Sent Events (SSE)

**Route Handler**: `/client/src/app/api/stream/route.ts`

The server maintains long-lived HTTP connections to push messages to clients:

- Uses `text/event-stream` content type
- Implements keep-alive pings (every 20 seconds)
- Broadcasts messages to all connected clients
- Connection management with cleanup on disconnect

**Client-Side Event Bus**: `/client/src/lib/sse-bus.ts`

- Manages SSE connections
- Provides event subscription pattern
- Handles reconnection logic
- Emits events for new messages

### 3. User Interface

#### Permission Button

The UI dynamically adapts based on notification state:

**Button Labels** (lines 292-297):
```typescript
const notificationLabel = {
  granted: "Notifications ON",
  denied: "Notifications Blocked",
  unsupported: "Notifications Not Available",
  default: "Enable Notifications",
}[notificationState];
```

**Status Messages** (lines 279-290):
```typescript
const notificationStatus = {
  granted: "You will receive desktop notifications for new messages.",
  denied: "Notification permission was denied. Enable in browser settings.",
  unsupported: "Desktop notifications are not supported in your browser.",
  default: "Click to enable desktop notifications for new messages.",
}[notificationState];
```

## Key Features

### ✅ What This Implementation Does

1. **Permission Handling**: Requests and tracks browser notification permissions
2. **Smart Filtering**: Prevents notifications for user's own messages
3. **Message Preview**: Shows username and message content (truncated if long)
4. **Profile Pictures**: Displays sender's avatar in notifications
5. **Real-Time Delivery**: Uses SSE for instant message delivery
6. **State Management**: Properly handles all permission states

### ❌ What This Implementation Does NOT Do

1. **Background Notifications**: Notifications only work when the browser tab is open
2. **Service Worker**: No background sync or offline capabilities
3. **Web Push Protocol**: No server-side push subscription management
4. **Cross-Device Sync**: No push subscription across multiple devices
5. **Custom Click Actions**: Notifications use browser defaults

## Limitations

### Browser Requirements

- Requires `Notification` API support
- Must have active browser tab/window
- Requires user permission grant

### Connection Requirements

- SSE connection must remain active
- Browser tab must be open (not background)
- Network connection required

## Comparison: Browser Notifications vs Web Push

### Current Implementation (Browser Notifications)

**Pros:**
- Simple implementation
- No server infrastructure needed
- No VAPID key management
- Works immediately with permission

**Cons:**
- Only works with tab open
- No offline delivery
- No background sync
- Lost connection = lost notifications

### Full Web Push (Not Implemented)

**Pros:**
- Works when tab closed
- Background notifications
- Offline message queuing
- Cross-device support

**Cons:**
- Complex setup (Service Worker, VAPID)
- Server-side infrastructure required
- Push service dependencies
- More maintenance overhead

## Browser Compatibility

The Notification API is supported in:
- ✅ Chrome/Edge 20+
- ✅ Firefox 22+
- ✅ Safari 7+
- ✅ Opera 23+
- ❌ IE (any version)

## User Experience Flow

1. **First Visit**: User sees "Enable Notifications" button
2. **Click Button**: Browser prompts for permission
3. **Grant Permission**: Button shows "Notifications ON"
4. **Receive Messages**: Desktop notifications appear automatically
5. **Own Messages**: No notification (filtered out)

## Code References

### Primary Files

1. **Chat Component**: `/client/src/components/chat-app.tsx`
   - Lines 374-379: State initialization
   - Lines 556-574: Notification display logic
   - Lines 822-837: Permission management
   - Lines 279-297: UI labels and messages

2. **SSE Stream**: `/client/src/app/api/stream/route.ts`
   - Server-side event streaming
   - Message broadcasting

3. **Event Bus**: `/client/src/lib/sse-bus.ts`
   - Client-side SSE handling
   - Event subscription pattern

## Testing Notifications

### Manual Testing Steps

1. Open the application in a browser
2. Click "Enable Notifications" button
3. Grant permission in browser prompt
4. Open application in another browser/tab
5. Send a message from the second instance
6. Verify notification appears in first instance

### Permission States

Test each state:
- **Default**: Fresh browser, no permission decision
- **Granted**: Permission allowed, notifications work
- **Denied**: Permission blocked, button shows status
- **Unsupported**: Old browser, feature unavailable

## Future Enhancements

If you want to add full Web Push capabilities:

1. **Add Service Worker**
   - Create `public/sw.js` file
   - Register service worker in app
   - Handle push events

2. **Server-Side Push**
   - Install `web-push` library
   - Generate VAPID keys
   - Store push subscriptions
   - Send push messages

3. **Subscription Management**
   - Subscribe to push service
   - Store subscription in database
   - Handle subscription updates
   - Manage device registrations

## Security Considerations

### Current Implementation

- ✅ No sensitive data in notifications (messages truncated)
- ✅ Client-side filtering (own messages excluded)
- ✅ Permission-based access
- ✅ No storage of notification data

### Best Practices

- Never include sensitive information in notification body
- Always check permission before displaying
- Handle permission denial gracefully
- Provide clear UI feedback

## Troubleshooting

### Notifications Not Appearing

1. **Check Permission**: Verify `Notification.permission === "granted"`
2. **Browser Tab**: Must be open (not background)
3. **SSE Connection**: Check if EventSource is connected
4. **Own Messages**: Verify message is from another user
5. **Browser Support**: Ensure browser supports Notifications API

### Permission Issues

1. **Denied State**: User must manually enable in browser settings
2. **Unsupported**: Browser too old or feature disabled
3. **Default State**: User hasn't made a decision yet

## Summary

Chat-PPC uses a **lightweight, browser-native notification system** that works well for real-time chat when users have the application open. It provides a simple, maintainable solution without the complexity of full Web Push infrastructure. For most chat applications where users actively engage with an open tab, this approach is sufficient and provides a good user experience.

For applications requiring notifications when closed or across multiple devices, consider upgrading to a full Service Worker-based Web Push implementation.
