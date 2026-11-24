// Writes the next timed meeting (ongoing or upcoming, next 24 h) as JSON to
// ~/.config/herdr-app/data/next-meeting.json. Skips all-day, canceled and declined events.
import EventKit
import Foundation

let out = FileManager.default.homeDirectoryForCurrentUser
  .appendingPathComponent(".config/herdr-app/data/next-meeting.json")

func write(_ obj: [String: Any]) {
  var o = obj
  o["updated"] = Int(Date().timeIntervalSince1970 * 1000)
  if let data = try? JSONSerialization.data(withJSONObject: o) { try? data.write(to: out, options: .atomic) }
}

let store = EKEventStore()
let done = DispatchSemaphore(value: 0)
var granted = false
store.requestFullAccessToEvents { ok, _ in granted = ok; done.signal() }
done.wait()
guard granted else { write(["error": "no-access"]); exit(0) }

let now = Date()
let pred = store.predicateForEvents(withStart: now.addingTimeInterval(-12 * 3600),
                                    end: now.addingTimeInterval(24 * 3600), calendars: nil)
let declined = { (e: EKEvent) in
  e.attendees?.first(where: { $0.isCurrentUser })?.participantStatus == .declined
}
let next = store.events(matching: pred)
  .filter { !$0.isAllDay && $0.endDate > now && $0.status != .canceled && !declined($0) }
  .sorted { $0.startDate < $1.startDate }
  .first

// The meeting room: a room attendee (how Google Calendar adds rooms), else the location
// with any links taken out (a location can be only a Meet or Zoom link). nil if none.
func room(_ e: EKEvent) -> String? {
  if let r = e.attendees?.first(where: { $0.participantType == .room })?.name, !r.isEmpty { return r }
  let loc = (e.location ?? "").replacingOccurrences(of: #"https?://\S+"#, with: "", options: .regularExpression)
    .trimmingCharacters(in: CharacterSet(charactersIn: " ,;").union(.whitespacesAndNewlines))
  return loc.isEmpty ? nil : loc
}

if let e = next {
  var o: [String: Any] = ["title": e.title ?? "(no title)",
         "start": Int(e.startDate.timeIntervalSince1970 * 1000),
         "end": Int(e.endDate.timeIntervalSince1970 * 1000),
         "recurring": e.hasRecurrenceRules,
         "calendar": e.calendar.title,
         "account": e.calendar.source.title]
  if let id = e.calendarItemExternalIdentifier { o["uid"] = id }
  if let r = room(e) { o["room"] = r }
  write(o)
} else {
  write(["none": true])
}
