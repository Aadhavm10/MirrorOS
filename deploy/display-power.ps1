<#
  Turns the mirror's panel on or off. Called by server/display.js on the sleep
  schedule; also safe to run by hand while testing:

      powershell -ExecutionPolicy Bypass -File display-power.ps1 -State off
      powershell -ExecutionPolicy Bypass -File display-power.ps1 -State on

  Edit this file if your panel needs different handling — nothing else depends
  on how it does the job, only on the -State argument.
#>

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('on', 'off')]
  [string]$State
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MirrorDisplay {
  [DllImport("user32.dll")]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

$HWND_BROADCAST  = [IntPtr]0xFFFF
$WM_SYSCOMMAND   = 0x0112
$SC_MONITORPOWER = [IntPtr]0xF170

if ($State -eq 'off') {
  # 2 = power off. This one is reliable.
  [void][MirrorDisplay]::SendMessage($HWND_BROADCAST, $WM_SYSCOMMAND, $SC_MONITORPOWER, [IntPtr]2)
  Write-Output 'display off'
}
else {
  # -1 (power on) is documented but widely ignored on modern Windows, so it is
  # only the first attempt.
  [void][MirrorDisplay]::SendMessage($HWND_BROADCAST, $WM_SYSCOMMAND, $SC_MONITORPOWER, [IntPtr](-1))
  Start-Sleep -Milliseconds 120

  # Fallback: inject F15. Deliberately not a mouse nudge — that risks surfacing
  # the pointer over the kiosk page, and Windows has no unclutter equivalent.
  # F15 is a key no application handles, and keybd_event injects at driver
  # level, so no physical keyboard needs to be attached.
  $VK_F15 = 0x7E
  $KEYEVENTF_KEYUP = 0x0002
  [MirrorDisplay]::keybd_event($VK_F15, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [MirrorDisplay]::keybd_event($VK_F15, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
  Write-Output 'display on'
}
